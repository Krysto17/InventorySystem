import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Batch settlement: manager assembles net payout (materials − light bill −
// advance) → owner approves → accountant pays. Plus advance partial/full
// deduction against the batch and the supplier debt balance.
describe("batch settlement (integration + RLS)", () => {
  let siteId: string;
  let mgr: TestUser, owner: TestUser, acct: TestUser, recv: TestUser;
  let supplierId: string, monaziteId: string;

  async function settlementRow(visitId: string, net: number, mat: number, light: number, adv: number, debt: number) {
    const { data, error } = await mgr.client.from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId,
      materials_total: mat, light_bill_total: light, advance_deducted: adv,
      net_balance: net, remaining_debt: debt, submitted_by: mgr.userId,
    }).select("id, status").single();
    if (error) throw error;
    return data!;
  }
  async function newVisit() {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "pricing", created_by: mgr.userId,
    }).select("id").single();
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    mgr   = await makeUser({ username: "bset-mgr",  role: "manager",    siteId });
    owner = await makeUser({ username: "bset-owner", role: "owner",     siteId: null });
    acct  = await makeUser({ username: "bset-acct", role: "accounting", siteId });
    recv  = await makeUser({ username: "bset-recv", role: "receiving",  siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Settle Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = m!.id as string;
  });

  it("approved advances build a supplier debt; partial deduction leaves a remainder", async () => {
    const { data: a } = await adminClient().from("advances")
      .insert({ supplier_id: supplierId, site_id: siteId, purpose: "Float", amount_naira: 50000 })
      .select("id").single();
    await adminClient().from("advances").update({ approval_status: "approved" }).eq("id", a!.id);

    // Manager deducts 20,000 of the 50,000 debt against a batch
    const v = await newVisit();
    const { error } = await mgr.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, ref_visit_id: v, amount: 20000, recorded_by: mgr.userId,
    });
    expect(error).toBeNull();
    const { data: debt } = await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId });
    expect(Number(debt)).toBe(30000); // 50,000 − 20,000 remaining
  });

  it("manager submits a batch settlement; owner approves; accountant pays", async () => {
    const v = await newVisit();
    // materials 100,000 − light bill 8,000 − advance 20,000 = 72,000 net; 30,000 debt remains
    const row = await settlementRow(v, 72000, 100000, 8000, 20000, 30000);
    expect(row.status).toBe("pending");

    // Accountant cannot approve…
    const tryAcct = await acct.client.from("batch_settlements").update({ status: "approved" }).eq("id", row.id);
    expect(tryAcct.error).not.toBeNull();
    // …owner approves
    const ok = await owner.client.from("batch_settlements").update({ status: "approved" }).eq("id", row.id);
    expect(ok.error).toBeNull();

    // Owner can't be skipped: accountant marks paid only after approval
    const pay = await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", row.id);
    expect(pay.error).toBeNull();
    const { data } = await adminClient().from("batch_settlements")
      .select("status, approved_by, paid_by, net_balance").eq("id", row.id).single();
    expect(data!.status).toBe("paid");
    expect(data!.approved_by).toBe(owner.userId);
    expect(data!.paid_by).toBe(acct.userId);
    expect(Number(data!.net_balance)).toBe(72000);
  });

  it("a settlement cannot be paid before it is approved", async () => {
    const v = await newVisit();
    const row = await settlementRow(v, 1000, 1000, 0, 0, 0);
    const { error } = await acct.client.from("batch_settlements").update({ status: "paid" }).eq("id", row.id);
    expect(error).not.toBeNull();
  });

  it("owner can reject a pending settlement; non-managers cannot submit", async () => {
    const v = await newVisit();
    const row = await settlementRow(v, 1000, 1000, 0, 0, 0);
    await owner.client.from("batch_settlements").update({ status: "rejected", rejection_note: "recheck prices" }).eq("id", row.id);
    const { data } = await adminClient().from("batch_settlements").select("status").eq("id", row.id).single();
    expect(data!.status).toBe("rejected");

    const v2 = await newVisit();
    const { error } = await recv.client.from("batch_settlements").insert({
      visit_id: v2, site_id: siteId, net_balance: 1, submitted_by: recv.userId,
    });
    expect(error).not.toBeNull();
  });
});
