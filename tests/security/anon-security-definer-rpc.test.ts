import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, anonClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * C1: an unauthenticated caller could reach privileged SECURITY DEFINER logic.
 *
 * Every one of these functions guards itself with `if not (<expr>) then raise`,
 * where <expr> compares current_role() / current_site() against something. With
 * no JWT those comparisons are NULL rather than false, so <expr> is NULL,
 * `not NULL` is NULL, and plpgsql does not take an IF branch on NULL — the
 * exception was skipped and execution carried on into the write, running as
 * postgres and bypassing RLS.
 *
 * 0152 closes it twice over: anon and PUBLIC lose EXECUTE (the boundary), and
 * the guards are wrapped in coalesce(..., false) so a NULL guard rejects even
 * if EXECUTE were ever granted back.
 *
 * These tests assert EFFECT, not just that an error came back. An error with
 * the row mutated anyway would be exactly the bug.
 */

// Every C1 function, with arguments PostgREST will accept. The ids are real
// where it matters (see the ledger test below) and otherwise arbitrary — the
// point is that the call is refused before it can look anything up.
const NOWHERE = "00000000-0000-0000-0000-000000000000";
const C1: { fn: string; args: Record<string, unknown> }[] = [
  { fn: "accountant_send_back_to_owner", args: { p_visit_id: NOWHERE, p_reason: "x" } },
  { fn: "approve_visit_by_manager", args: { p_visit_id: NOWHERE, p_skip_qc: true } },
  { fn: "authorize_gate_pass", args: { p_pass_id: NOWHERE } },
  { fn: "close_dressing_only", args: { p_visit_id: NOWHERE, p_carry: false } },
  { fn: "close_settlement", args: { p_id: NOWHERE } },
  { fn: "delete_supplier", args: { p_supplier_id: NOWHERE } },
  { fn: "hold_advance", args: { p_id: NOWHERE } },
  { fn: "hold_expense", args: { p_id: NOWHERE } },
  { fn: "hold_settlement", args: { p_id: NOWHERE } },
  { fn: "manager_skip_to_pricing", args: { p_visit_id: NOWHERE } },
  { fn: "mark_price_correction_paid", args: { p_id: NOWHERE } },
  { fn: "record_debt_repayment", args: { p_supplier_id: NOWHERE, p_amount: 1, p_note: "x", p_kind: "purchase" } },
  { fn: "record_settlement_payment", args: { p_settlement_id: NOWHERE, p_amount: 1, p_method: "cash" } },
  { fn: "record_stock_check", args: { p_lot_id: NOWHERE, p_status: "ok", p_counted_weight: 1, p_note: "x" } },
  { fn: "release_advance", args: { p_id: NOWHERE } },
  { fn: "release_expense", args: { p_id: NOWHERE } },
  { fn: "release_settlement", args: { p_id: NOWHERE } },
  { fn: "remove_line", args: { p_line_id: NOWHERE } },
  { fn: "reopen_processing_fee", args: { p_visit_id: NOWHERE } },
  { fn: "reopen_receiving", args: { p_visit_id: NOWHERE } },
  { fn: "resettle_line", args: { p_line_id: NOWHERE } },
  { fn: "reverse_paid_supply", args: { p_visit_id: NOWHERE, p_reason: "x" } },
  { fn: "send_advance_back", args: { p_id: NOWHERE, p_reason: "x" } },
  { fn: "send_expense_back", args: { p_id: NOWHERE, p_reason: "x" } },
  { fn: "send_settlement_back", args: { p_id: NOWHERE, p_reason: "x" } },
  { fn: "submit_visit_to_manager", args: { p_visit_id: NOWHERE } },
  { fn: "sync_processing_fee", args: { p_visit_id: NOWHERE } },
  { fn: "unsettle_line", args: { p_line_id: NOWHERE, p_reason: "x" } },
];

describe("anon cannot reach privileged SECURITY DEFINER RPCs (C1)", () => {
  // ── 1. The ACL boundary, function by function ────────────────────────────
  describe("EXECUTE is refused", () => {
    for (const { fn, args } of C1) {
      it(`anon cannot call ${fn}`, async () => {
        const { error } = await anonClient().rpc(fn, args as never);
        expect(error, `${fn} must refuse an unauthenticated caller`).not.toBeNull();
        // A refusal at the privilege layer, not "I looked it up and found
        // nothing" — the latter is what the bug looked like.
        const msg = `${error?.message ?? ""} ${error?.code ?? ""}`.toLowerCase();
        expect(msg, `${fn} refused for the wrong reason: ${error?.message}`)
          .not.toMatch(/not found|does not exist for this/);
      });
    }
  });

  // ── 2. The guard itself fails closed, independently of the ACL ───────────
  it("_can_review_payable answers false for an unauthenticated caller, never NULL", async () => {
    // The predicate behind the nine hold/release/send-back functions. NULL here
    // is the whole defect: `if not NULL` does not raise.
    const { data, error } = await anonClient().rpc("_can_review_payable", { p_site: NOWHERE } as never);
    if (error) return; // revoked as well — also acceptable
    expect(data).not.toBeNull();
    expect(data).toBe(false);
  });

  // ── 3. Effect: the ledger is untouched after an anonymous attempt ────────
  describe("no financial state changes under an anonymous attempt", () => {
    let settlementId: string, visitId: string, supplierId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      const siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").limit(1).single();
      const author = await makeUser({ username: `c1-fix-${Date.now()}`, role: "accounting", siteId });
      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `C1 ${Date.now()}-${Math.random()}` }).select("id").single();
      supplierId = sup!.id as string;
      const { data: v, error: vErr } = await admin.from("visits").insert({
        site_id: siteId, supplier_id: supplierId, declared_material_type_id: mt!.id,
        entry_path: "processed", state: "in_accounting", created_by: author.userId,
      }).select("id").single();
      expect(vErr, `visit fixture: ${vErr?.message}`).toBeNull();
      visitId = v!.id as string;
      const { data: st } = await admin.from("batch_settlements").insert({
        visit_id: visitId, site_id: siteId, materials_total: 40_000, light_bill_total: 0,
        other_deductions_total: 0, advance_deducted: 0, net_balance: 40_000, status: "approved",
      }).select("id").single();
      settlementId = st!.id as string;
    });

    it("an approved settlement cannot be held, released, sent back or paid by anon", async () => {
      const anon = anonClient();
      const attempts = [
        anon.rpc("hold_settlement", { p_id: settlementId } as never),
        anon.rpc("release_settlement", { p_id: settlementId } as never),
        anon.rpc("send_settlement_back", { p_id: settlementId, p_reason: "anon" } as never),
        anon.rpc("close_settlement", { p_id: settlementId } as never),
        anon.rpc("record_settlement_payment",
          { p_settlement_id: settlementId, p_amount: 40_000, p_method: "cash" } as never),
      ];
      const errors = await Promise.all(attempts.map(async (a) => (await a).error));

      // State first: an error with the row changed anyway is precisely the bug,
      // so assert the ledger before asserting that each call was refused.
      const admin = adminClient();
      const { data: after } = await admin.from("batch_settlements")
        .select("status, net_balance").eq("id", settlementId).single();
      expect(after!.status, "settlement status must be untouched").toBe("approved");
      expect(Number(after!.net_balance)).toBe(40_000);

      const { data: paid } = await admin.from("settlement_payments")
        .select("id").eq("settlement_id", settlementId);
      expect(paid ?? [], "anon must not have recorded a payment").toHaveLength(0);

      errors.forEach((e, i) =>
        expect(e, `anon call #${i + 1} must be refused outright`).not.toBeNull());
    });

    it("the supplier still exists after an anonymous delete_supplier", async () => {
      expect((await anonClient().rpc("delete_supplier", { p_supplier_id: supplierId } as never)).error)
        .not.toBeNull();
      const { data } = await adminClient().from("suppliers").select("id").eq("id", supplierId);
      expect(data ?? [], "anon must not delete a supplier").toHaveLength(1);
    });

    it("the visit is still where it was after anonymous workflow calls", async () => {
      const anon = anonClient();
      for (const a of [
        anon.rpc("submit_visit_to_manager", { p_visit_id: visitId } as never),
        anon.rpc("manager_skip_to_pricing", { p_visit_id: visitId } as never),
        anon.rpc("reopen_receiving", { p_visit_id: visitId } as never),
      ]) expect((await a).error).not.toBeNull();
      const { data } = await adminClient().from("visits").select("state").eq("id", visitId).single();
      expect(data!.state).toBe("in_accounting");
    });
  });

  // ── 4. The legitimate callers are unaffected ─────────────────────────────
  describe("authorized callers still work, unauthorized ones still do not", () => {
    let owner: TestUser, processing: TestUser, heldId: string;

    beforeAll(async () => {
      const admin = adminClient();
      const { data: sites } = await admin.from("sites").select("id, name");
      const siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
      const { data: mt } = await admin.from("material_types").select("id").limit(1).single();
      const stamp = Date.now();
      owner = await makeUser({ username: `c1-owner-${stamp}`, role: "owner", siteId: null });
      processing = await makeUser({ username: `c1-proc-${stamp}`, role: "processing", siteId });

      const { data: sup } = await admin.from("suppliers")
        .insert({ name: `C1 held ${stamp}-${Math.random()}` }).select("id").single();
      const { data: v } = await admin.from("visits").insert({
        site_id: siteId, supplier_id: sup!.id, declared_material_type_id: mt!.id,
        entry_path: "processed", state: "in_accounting", created_by: processing.userId,
      }).select("id").single();
      const { data: st, error: stErr } = await admin.from("batch_settlements").insert({
        visit_id: v!.id, site_id: siteId, materials_total: 10_000, light_bill_total: 0,
        other_deductions_total: 0, advance_deducted: 0, net_balance: 10_000, status: "on_hold",
      }).select("id").single();
      expect(stErr, `settlement fixture: ${stErr?.message}`).toBeNull();
      heldId = st!.id as string;
    });

    it("a role with no payable-review rights is still refused", async () => {
      const { error } = await processing.client.rpc("release_settlement", { p_id: heldId } as never);
      expect(error, "processing must not release a payment").not.toBeNull();
      const { data } = await adminClient().from("batch_settlements")
        .select("status").eq("id", heldId).single();
      expect(data!.status, "the refusal must not have changed anything").toBe("on_hold");
    });

    it("the owner can still release a held settlement", async () => {
      const { error } = await owner.client.rpc("release_settlement", { p_id: heldId } as never);
      expect(error, `owner release must still work: ${error?.message}`).toBeNull();
      const { data } = await adminClient().from("batch_settlements")
        .select("status").eq("id", heldId).single();
      expect(data!.status, "0152 must not have broken the legitimate path").toBe("approved");
    });
  });
});
