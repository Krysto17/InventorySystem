import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs } from "../setup/approvals";
import { requestKeyFrom, REQUEST_KEY_FIELD } from "@/lib/actions/request-key";

/**
 * "Pay remaining" failed in production for every supplier with:
 *   That payment could not be identified. Refresh the page and try again.
 *
 * T8 gave the payment actions a required command id and minted it inside
 * ActionForm — but the payment screens are not ActionForm. MarkPaidButton and
 * RecordPaymentForm are hand-rolled client components with their own
 * useActionState and their own <form>, so they submitted `settlement_id` and
 * nothing else. The business identifier was never the problem; the command id
 * simply was not there, and the action refused before reaching the database.
 *
 * These tests pin both halves: the payload contract every money form must meet,
 * and the idempotency it exists to provide.
 */
describe("payment command id (T8 regression)", () => {
  const stamp = Date.now().toString(36);
  const src = (p: string) => readFileSync(`src/${p}`, "utf8");

  // ── the contract that broke ───────────────────────────────────────────────

  it("1. the original failure: a payment payload without a command id is refused", () => {
    // Exactly what MarkPaidButton used to submit for "Pay remaining".
    const withoutId = new FormData();
    withoutId.set("settlement_id", crypto.randomUUID());
    expect(withoutId.get("settlement_id"), "the business identifier was always present").toBeTruthy();
    expect(requestKeyFrom(withoutId), "but the command id was not").toBeNull();

    // and that null is precisely the branch that returned the operator message
    const action = src("app/(accounting)/accounting/payouts/actions.ts");
    expect(action).toContain("That payment could not be identified");
  });

  it("2. every money form mints a command id, whether or not it uses ActionForm", () => {
    // The minting lives in one hook so these cannot drift apart again.
    const hook = src("components/ui/use-command-id.ts");
    expect(hook).toContain("REQUEST_KEY_FIELD");
    expect(hook, "the id survives a failed or unanswered submit").toContain("if (state.ok) commandId.current = null");

    for (const f of [
      "components/ui/ActionForm.tsx",              // the shared wrapper
      "components/accounting/MarkPaidButton.tsx",  // "Pay remaining"
      "components/visits/RecordPaymentForm.tsx",   // installments and cash payouts
    ]) {
      const body = src(f);
      expect(body, `${f} must mint a command id`).toContain("useCommandId");
      expect(body, `${f} must submit through the wrapped action`).toMatch(/action=\{submit\}/);
    }
  });

  it("3. the payment forms still send their business identifier", () => {
    expect(src("components/accounting/MarkPaidButton.tsx"))
      .toMatch(/name=\{inputName\}/);
    const rec = src("components/visits/RecordPaymentForm.tsx");
    expect(rec, "settlement id").toContain('name="settlement_id"');
    expect(rec, "visit id").toContain('name="visit_id"');
  });

  it("4. the command id augments the payload, it never replaces it", () => {
    const fd = new FormData();
    fd.set("settlement_id", "11111111-1111-1111-1111-111111111111");
    fd.set("amount", "500");
    const id = crypto.randomUUID();
    fd.set(REQUEST_KEY_FIELD, id);          // what useCommandId does
    expect(fd.get("settlement_id"), "business identifier survives").toBe("11111111-1111-1111-1111-111111111111");
    expect(fd.get("amount")).toBe("500");
    expect(requestKeyFrom(fd)).toBe(id);
  });

  // ── the behaviour it protects ─────────────────────────────────────────────

  describe("against the database", () => {
    let dong: string, sup: string, mat: string;
    let owner: TestUser, acct: TestUser;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      dong = sites!.find((s) => s.name === "Dong")!.id as string;
      sup = (await admin.from("suppliers").insert({ name: `PayFix ${stamp}` }).select("id").single()).data!.id as string;
      mat = (await admin.from("material_types").insert({ name: `PayFix ${stamp}` }).select("id").single()).data!.id as string;
      owner = await makeUser({ username: `pf-owner-${stamp}`, role: "owner", siteId: null });
      acct = await makeUser({ username: `pf-acct-${stamp}`, role: "accounting", siteId: dong });
    });

    async function approvedSettlement(kg: number, price: number) {
      const admin = adminClient();
      const { data: v } = await admin.from("visits").insert({
        site_id: dong, supplier_id: sup, declared_material_type_id: mat,
        entry_path: "processed", state: "awaiting_price_approval", created_by: owner.id,
      }).select("id").single();
      const visitId = (v as { id: string }).id;
      await admin.from("visit_materials").insert({
        visit_id: visitId, material_type_id: mat, weight_kg: kg, unit_price: price, requires_analysis: false,
      });
      expect((await approvePricingAs(owner.client, visitId)).error).toBeNull();
      const { data: s } = await admin.from("batch_settlements")
        .select("id, net_balance").eq("visit_id", visitId).single();
      return { visitId, settlementId: (s as { id: string }).id, net: Number((s as { net_balance: number }).net_balance) };
    }
    const pay = (settlementId: string, amount: number, key: string) =>
      acct.client.rpc("record_settlement_payment", {
        p_settlement_id: settlementId, p_amount: amount, p_method: "transfer", p_request_key: key,
      });
    const paymentsOf = async (settlementId: string) =>
      (await adminClient().from("settlement_payments").select("id, amount").eq("settlement_id", settlementId)).data ?? [];

    it("5. pay remaining, with a command id, succeeds and completes the settlement", async () => {
      const { settlementId, net } = await approvedSettlement(100, 100);
      expect((await pay(settlementId, net, crypto.randomUUID())).error).toBeNull();
      expect(await paymentsOf(settlementId)).toHaveLength(1);
      const { data } = await adminClient().from("batch_settlements").select("status").eq("id", settlementId).single();
      expect(data!.status).toBe("paid");
    });

    it("6. the same command replayed pays the supplier once", async () => {
      const { settlementId, net } = await approvedSettlement(50, 100);
      const key = crypto.randomUUID();
      const first = await pay(settlementId, net, key);
      expect(first.error).toBeNull();
      const replay = await pay(settlementId, net, key);
      expect(replay.error, "a replay is not an error").toBeNull();
      expect(replay.data, "it returns the payment the first call made").toBe(first.data);
      expect(await paymentsOf(settlementId), "one payout, not two").toHaveLength(1);
    });

    it("7. a different command is a legitimate second installment", async () => {
      const { settlementId, net } = await approvedSettlement(100, 100);
      expect((await pay(settlementId, net / 2, crypto.randomUUID())).error).toBeNull();
      expect((await pay(settlementId, net / 2, crypto.randomUUID())).error).toBeNull();
      const rows = await paymentsOf(settlementId);
      expect(rows, "two installments").toHaveLength(2);
      expect(rows.reduce((t, r) => t + Number(r.amount), 0)).toBe(net);
    });

    it("8. completing a settlement stocks it exactly once", async () => {
      const { visitId, settlementId, net } = await approvedSettlement(75, 100);
      const key = crypto.randomUUID();
      expect((await pay(settlementId, net, key)).error).toBeNull();
      expect((await pay(settlementId, net, key)).error, "replay after completion").toBeNull();

      const admin = adminClient();
      const { data: lines } = await admin.from("visit_materials").select("id").eq("visit_id", visitId);
      const { data: lots } = await admin.from("stock_lots").select("id")
        .in("ref_visit_material_id", (lines ?? []).map((l) => l.id as string));
      expect(lots ?? [], "one lot").toHaveLength(1);
      const { data: moves } = await admin.from("stock_movements").select("id")
        .eq("ref_visit_id", visitId).eq("reason", "purchase_intake");
      expect(moves ?? [], "one intake movement").toHaveLength(1);
    });

    it("9. T8 is intact: a payment with no command id is still refused by the database", async () => {
      const { settlementId } = await approvedSettlement(10, 100);
      const res = await acct.client.rpc("record_settlement_payment", {
        p_settlement_id: settlementId, p_amount: 100, p_method: "transfer",
      } as never);
      expect(res.error?.code, "ID001 — the protection stays").toBe("ID001");
      expect(await paymentsOf(settlementId)).toHaveLength(0);
    });
  });
});
