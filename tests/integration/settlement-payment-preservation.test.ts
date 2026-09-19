import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";
import { approvePricingAs } from "../setup/approvals";

// 0156 (3F-T1): once a payment is recorded against a settlement, nothing deletes
// that settlement — not the accountant's send-back, not the owner's re-approval,
// not a batch delete by any role, not a direct table delete. Before 0156 each of
// those erased real supplier payments through settlement_payments' ON DELETE
// CASCADE. A settlement with no payments keeps its existing workflow.

const REPEAT = 6;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const INTERNALS = /batch_settlements|settlement_payments|visits|constraint|SQLSTATE|SP001|violates/i;

describe("settlement payment preservation (0156)", () => {
  const stamp = Date.now().toString(36);
  let siteA: string, newSite: string, material: string, supplierId: string;
  let owner: TestUser, acct: TestUser, acct2: TestUser, mgr: TestUser, gm: TestUser, owner2: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: `spp-own-${stamp}`, role: "owner", siteId: null });
    owner2 = await makeUser({ username: `spp-own-${stamp}`, role: "owner", siteId: null }); // second session
    acct = await makeUser({ username: `spp-acct-${stamp}`, role: "accounting", siteId: siteA });
    acct2 = await makeUser({ username: `spp-acct-${stamp}`, role: "accounting", siteId: siteA }); // second session
    mgr = await makeUser({ username: `spp-mgr-${stamp}`, role: "manager", siteId: siteA });
    gm = await makeUser({ username: `spp-gm-${stamp}`, role: "manager", siteId: newSite });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `SPP ${stamp}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    material = mt!.id as string;
  });

  // A batch on site A with one priced 100 kg line and a settlement for 100,000.
  async function batch(state: string, status = "approved") {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteA, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state, created_by: mgr.userId,
    }).select("id").single();
    const visitId = v!.id as string;
    await adminClient().from("visit_materials").insert({
      visit_id: visitId, material_type_id: material, weight_kg: 100, unit_price: 1000,
      price_finalized: state === "in_accounting", requires_analysis: false,
    });
    const { data: st, error } = await adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteA, materials_total: 100000, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 100000,
      submitted_by: mgr.userId, status, approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw error;
    return { visitId, settlementId: st!.id as string };
  }

  async function pay(settlementId: string, amount: number, who: TestUser = acct) {
    const { error } = await who.client.rpc("record_settlement_payment", {
      p_settlement_id: settlementId, p_amount: amount, p_method: "transfer",
    });
    if (error) throw error;
  }

  async function snapshot(visitId: string, settlementId: string) {
    const admin = adminClient();
    const [{ data: v }, { data: st }, { data: pays }] = await Promise.all([
      admin.from("visits").select("state").eq("id", visitId).maybeSingle(),
      admin.from("batch_settlements").select("id, status, net_balance").eq("id", settlementId).maybeSingle(),
      admin.from("settlement_payments").select("amount").eq("settlement_id", settlementId),
    ]);
    return {
      visitState: (v?.state as string | undefined) ?? null,
      settlementStatus: (st?.status as string | undefined) ?? null,
      payments: (pays ?? []).length,
      paidTotal: (pays ?? []).reduce((a, p) => a + Number(p.amount), 0),
    };
  }

  // ── 1. zero payments: send-back keeps working ──────────────────────────────
  it("1. a zero-payment approved settlement is still sent back to the owner", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    const { error } = await acct.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "recheck price" });
    expect(error).toBeNull();
    const snap = await snapshot(visitId, settlementId);
    expect(snap.settlementStatus, "the unpaid settlement is voided as before").toBeNull();
    expect(snap.visitState).toBe("awaiting_price_approval");
  });

  // ── 2 + 3. part payment: send-back refused, nothing changes ────────────────
  it("2/3. a partially paid settlement cannot be sent back, and the refusal changes nothing", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    await pay(settlementId, 30000);
    const before = await snapshot(visitId, settlementId);
    expect(before).toEqual({ visitState: "in_accounting", settlementStatus: "partially_paid", payments: 1, paidTotal: 30000 });

    const { error } = await acct.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "price wrong" });
    expect(error?.code).toBe("SP001");
    expect(await snapshot(visitId, settlementId)).toEqual(before);
    const { data: lines } = await adminClient().from("visit_materials").select("price_finalized").eq("visit_id", visitId);
    expect(lines!.every((l) => l.price_finalized === true), "line prices stay locked").toBe(true);
    const { data: comments } = await adminClient().from("batch_comments").select("id").eq("visit_id", visitId);
    expect(comments ?? [], "no send-back comment was posted").toHaveLength(0);

    // The owner can call the same RPC; no bypass.
    const byOwner = await owner.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: "owner try" });
    expect(byOwner.error?.code).toBe("SP001");
    expect(await snapshot(visitId, settlementId)).toEqual(before);
  });

  it("2b. the payables send-back refuses a settlement with a payment, with the same code", async () => {
    // send_settlement_back only accepts approved / on_hold, so a payment row is
    // only there when it landed between the page load and the click — the race
    // its unlocked check used to lose. Build exactly that shape.
    const { visitId, settlementId } = await batch("in_accounting");
    const { error: insErr } = await adminClient().from("settlement_payments").insert({
      settlement_id: settlementId, site_id: siteA, amount: 1000, method: "cash", paid_by: acct.userId,
    });
    if (insErr) throw insErr;
    const before = await snapshot(visitId, settlementId);
    expect(before.settlementStatus).toBe("approved");
    const { error } = await owner.client.rpc("send_settlement_back", { p_id: settlementId, p_reason: "late" });
    expect(error?.code).toBe("SP001");
    expect(await snapshot(visitId, settlementId)).toEqual(before);
  });

  // ── 4 + 5. owner re-approval ───────────────────────────────────────────────
  it("4. re-approval cannot replace a settlement that has payments", async () => {
    const { visitId, settlementId } = await batch("awaiting_price_approval");
    await pay(settlementId, 25000);
    const before = await snapshot(visitId, settlementId);
    const { error } = await approvePricingAs(owner.client, visitId);
    expect(error?.code).toBe("SP001");
    expect(await snapshot(visitId, settlementId)).toEqual(before);
    const { data: all } = await adminClient().from("batch_settlements").select("id").eq("visit_id", visitId);
    expect((all ?? []).map((r) => r.id), "same settlement, not a replacement").toEqual([settlementId]);
  });

  it("5. zero-payment repricing still replaces the settlement", async () => {
    const { visitId, settlementId } = await batch("awaiting_price_approval");
    const { error } = await approvePricingAs(owner.client, visitId);
    expect(error).toBeNull();
    const { data: all } = await adminClient().from("batch_settlements").select("id, status").eq("visit_id", visitId);
    expect(all ?? []).toHaveLength(1);
    expect(all![0].id, "a fresh settlement").not.toBe(settlementId);
    expect(all![0].status).toBe("approved");
    expect((await snapshot(visitId, all![0].id as string)).visitState).toBe("in_accounting");
  });

  // ── 6–9. batch delete with payments: every role refused ────────────────────
  for (const who of ["manager", "general manager", "owner"] as const) {
    it(`6-9. the ${who} cannot delete a partially paid batch, and its payments remain`, async () => {
      const actor = who === "manager" ? mgr : who === "general manager" ? gm : owner;
      const { visitId, settlementId } = await batch("in_accounting");
      await pay(settlementId, 40000);
      const before = await snapshot(visitId, settlementId);
      const { error } = await actor.client.rpc("delete_batch", { p_visit_id: visitId });
      expect(error?.code).toBe("SP001");
      expect(await snapshot(visitId, settlementId)).toEqual(before);
      expect(before.payments).toBe(1);
    });
  }

  // ── 10 + 11. existing delete rules unchanged ───────────────────────────────
  it("10. a paid batch remains undeletable", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    await pay(settlementId, 100000);
    const before = await snapshot(visitId, settlementId);
    expect(before.settlementStatus).toBe("paid");
    const { error } = await owner.client.rpc("delete_batch", { p_visit_id: visitId });
    expect(error).not.toBeNull();
    expect(await snapshot(visitId, settlementId)).toEqual(before);
  });

  it("11. a zero-payment batch the owner may delete is still deleted, settlement included", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    const { error } = await owner.client.rpc("delete_batch", { p_visit_id: visitId });
    expect(error).toBeNull();
    const snap = await snapshot(visitId, settlementId);
    expect(snap.visitState).toBeNull();
    expect(snap.settlementStatus, "the FK cascade still removes an unpaid settlement").toBeNull();
  });

  // ── 12. direct deletes bypass the RPCs but not the trigger ────────────────
  it("12. a direct table delete of a settlement with payments is refused (GM cross-site policy)", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    await pay(settlementId, 10000);
    const before = await snapshot(visitId, settlementId);
    const res = await gm.client.from("batch_settlements").delete().eq("id", settlementId).select("id");
    expect(res.error?.code).toBe("SP001");
    expect(await snapshot(visitId, settlementId)).toEqual(before);
  });

  it("12b. even the service role cannot cascade payments away by deleting the visit", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    await pay(settlementId, 10000);
    const before = await snapshot(visitId, settlementId);
    const res = await adminClient().from("visits").delete().eq("id", visitId).select("id");
    expect(res.error?.code).toBe("SP001");
    expect(await snapshot(visitId, settlementId)).toEqual(before);
  });

  it("12c. the cascade itself is intact: deleting a visit with an unpaid settlement removes it", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    const res = await adminClient().from("visits").delete().eq("id", visitId).select("id");
    expect(res.error).toBeNull();
    expect((await snapshot(visitId, settlementId)).settlementStatus).toBeNull();
  });

  // ── 13. concurrent payment vs send-back ────────────────────────────────────
  it("13. payment racing send-back never loses a committed payment", async () => {
    const outcomes = { paymentWon: 0, sendBackWon: 0 };
    for (let i = 0; i < REPEAT; i++) {
      const { visitId, settlementId } = await batch("in_accounting");
      const [payRes, sbRes] = await Promise.all([
        acct.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 20000, p_method: "transfer" }),
        acct2.client.rpc("accountant_send_back_to_owner", { p_visit_id: visitId, p_reason: `race ${i}` }),
      ]);
      const snap = await snapshot(visitId, settlementId);
      if (payRes.error === null) {
        // Payment committed: it must still be there, and send-back must have lost.
        expect(snap.payments, "a committed payment is never deleted").toBe(1);
        expect(sbRes.error?.code).toBe("SP001");
        expect(snap.settlementStatus).toBe("partially_paid");
        expect(snap.visitState).toBe("in_accounting");
        outcomes.paymentWon++;
      } else {
        // Send-back went first: the payment found nothing to pay.
        expect(sbRes.error).toBeNull();
        expect(snap.settlementStatus).toBeNull();
        expect(snap.payments).toBe(0);
        expect(snap.visitState).toBe("awaiting_price_approval");
        outcomes.sendBackWon++;
      }
    }
    expect(outcomes.paymentWon + outcomes.sendBackWon).toBe(REPEAT);
  });

  // ── 14. concurrent payment vs batch delete ─────────────────────────────────
  it("14. payment racing batch delete never loses a committed payment", async () => {
    const outcomes = { paymentWon: 0, deleteWon: 0 };
    for (let i = 0; i < REPEAT; i++) {
      const { visitId, settlementId } = await batch("in_accounting");
      const [payRes, delRes] = await Promise.all([
        acct.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 20000, p_method: "transfer" }),
        owner2.client.rpc("delete_batch", { p_visit_id: visitId }),
      ]);
      const snap = await snapshot(visitId, settlementId);
      if (payRes.error === null) {
        expect(snap.payments, "a committed payment is never deleted").toBe(1);
        expect(delRes.error?.code).toBe("SP001");
        expect(snap.visitState).toBe("in_accounting");
        outcomes.paymentWon++;
      } else {
        expect(delRes.error).toBeNull();
        expect(snap.visitState).toBeNull();
        expect(snap.payments).toBe(0);
        outcomes.deleteWon++;
      }
    }
    expect(outcomes.paymentWon + outcomes.deleteWon).toBe(REPEAT);
  });

  // ── 15. operator messages ──────────────────────────────────────────────────
  it("15. the refusal and the operator messages carry no database internals", async () => {
    const { visitId, settlementId } = await batch("in_accounting");
    await pay(settlementId, 5000);
    const { error } = await owner.client.rpc("delete_batch", { p_visit_id: visitId });
    expect(error?.code).toBe("SP001");
    expect(error!.message).not.toMatch(UUID);
    expect(error!.message).not.toMatch(/batch_settlements|settlement_payments|constraint/i);

    // Each caller maps SP001 to a fixed sentence before its generic fallback.
    const callers: [string, string, RegExp][] = [
      ["src/app/visits/[id]/finance-actions.ts", "accountant_send_back_to_owner", /Resolve the payment before sending it back for repricing\./],
      ["src/app/payables/actions.ts", "SEND_BACK[kind]", /Resolve the payment before sending it back for repricing\./],
      ["src/app/visits/[id]/batch-actions.ts", "\"delete_batch\"", /This batch has recorded payments and cannot be deleted\./],
      ["src/app/visits/[id]/batch-actions.ts", "\"approve_pricing\"", /Resolve the payment before repricing it\./],
    ];
    for (const [file, rpc, sentence] of callers) {
      const src = readFileSync(file, "utf8");
      const at = src.indexOf(rpc);
      expect(at, `${file} calls ${rpc}`).toBeGreaterThan(-1);
      const after = src.slice(at);
      const mapped = after.indexOf('"SP001"');
      const fallback = after.indexOf("error.message");
      expect(mapped, `${file}: SP001 mapped`).toBeGreaterThan(-1);
      expect(mapped, `${file}: mapped before the raw fallback`).toBeLessThan(fallback);
      const line = after.slice(mapped, after.indexOf("\n", after.indexOf("fail(", mapped)));
      expect(line).toMatch(sentence);
      const text = line.match(/fail\(\s*"([^"]+)"/)?.[1] ?? "";
      expect(text).not.toMatch(UUID);
      expect(text).not.toMatch(INTERNALS);
    }
  });
});
