import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 11 (A): approved advances form a supplier debt; deductions recover it
// partially; outstanding balance is automatic; over-deduction is blocked.
describe("supplier debt ledger (advances + deductions)", () => {
  let siteAId: string, siteBId: string;
  let mgrA: TestUser, acctA: TestUser, invA: TestUser, owner: TestUser;
  let supplierId: string;

  async function debt(): Promise<number> {
    const { data, error } = await adminClient().rpc("supplier_outstanding_debt", {
      _supplier_id: supplierId,
    });
    if (error) throw error;
    return Number(data);
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    mgrA  = await makeUser({ username: "debt-mgr-a",  role: "manager",    siteId: siteAId });
    acctA = await makeUser({ username: "debt-acct-a", role: "accounting", siteId: siteAId });
    invA  = await makeUser({ username: "debt-inv-a",  role: "inventory",  siteId: siteAId });
    owner = await makeUser({ username: "debt-owner",  role: "owner",      siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Debt Supplier" }).select("id").single();
    supplierId = s!.id as string;
  });

  it("walks multiple advances + partial deductions with a running balance", async () => {
    expect(await debt()).toBe(0);

    // Only PAID advances count toward debt (owner approves → accountant pays).
    const payAdvance = async (id: string) => {
      await adminClient().from("advances").update({ approval_status: "approved" }).eq("id", id);
      await adminClient().from("advances").update({ approval_status: "paid" }).eq("id", id);
    };
    const { data: a1 } = await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteAId, purpose: "Float 1", amount_naira: 30000,
    }).select("id").single();
    await payAdvance(a1!.id);
    const { data: a2 } = await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteAId, purpose: "Float 2", amount_naira: 20000,
    }).select("id").single();
    expect(await debt()).toBe(30000); // a2 still pending (not paid)

    await payAdvance(a2!.id);
    expect(await debt()).toBe(50000);

    // Manager deducts part from a payout → remainder carries forward.
    const { error: d1 } = await mgrA.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteAId, amount: 18000,
      notes: "Withheld from payout", recorded_by: mgrA.userId,
    });
    expect(d1).toBeNull();
    expect(await debt()).toBe(32000);

    // Accountant records a cash repayment.
    const { error: d2 } = await acctA.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteAId, amount: 2000,
      notes: "Cash repayment", recorded_by: acctA.userId,
    });
    expect(d2).toBeNull();
    expect(await debt()).toBe(30000);
  });

  it("blocks a deduction that exceeds the outstanding debt", async () => {
    const outstanding = await debt();
    const { error } = await mgrA.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteAId, amount: outstanding + 1,
      recorded_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/exceeds outstanding debt/);
    expect(await debt()).toBe(outstanding);
  });

  it("inventory cannot record deductions", async () => {
    const { error } = await invA.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteAId, amount: 1, recorded_by: invA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("manager cannot deduct on another site; owner can", async () => {
    const { error } = await mgrA.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteBId, amount: 1, recorded_by: mgrA.userId,
    });
    expect(error).not.toBeNull();

    const { error: oErr } = await owner.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteBId, amount: 1000, recorded_by: owner.userId,
    });
    expect(oErr).toBeNull();
  });
});
