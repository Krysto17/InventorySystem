import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Owner seeds a supplier's pre-software debt as an opening balance; it counts as
// outstanding debt, deductions reduce it, and it can't be double-recorded or set
// by a non-owner.
describe("supplier opening balance", () => {
  let siteId: string;
  let owner: TestUser, mgr: TestUser;
  let supplierId: string;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    owner = await makeUser({ username: "ob-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "ob-mgr", role: "manager", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `OB ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
  });

  it("owner records an opening balance; it becomes outstanding debt (paid, not in payout queue)", async () => {
    const { error } = await owner.client.rpc("record_opening_balance", {
      p_supplier_id: supplierId, p_amount: 50000, p_as_of: "2026-07-01",
    });
    expect(error).toBeNull();

    const { data: debt } = await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId });
    expect(Number(debt)).toBe(50000);

    const { data: adv } = await adminClient().from("advances")
      .select("approval_status, purpose").eq("supplier_id", supplierId).single();
    expect(adv!.approval_status).toBe("paid"); // never shows in the "approved to pay" queue
    expect(adv!.purpose).toBe("Opening balance (pre-software)");
  });

  it("a deduction reduces the opening debt; over-deduction is blocked", async () => {
    const { error: dErr } = await adminClient().from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, amount: 20000, recorded_by: mgr.userId,
    });
    expect(dErr).toBeNull();
    const { data: debt } = await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId });
    expect(Number(debt)).toBe(30000);

    const { error: over } = await adminClient().from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, amount: 40000, recorded_by: mgr.userId,
    });
    expect(over).not.toBeNull(); // exceeds remaining debt
  });

  it("refuses a second opening balance for the same supplier", async () => {
    const { error } = await owner.client.rpc("record_opening_balance", {
      p_supplier_id: supplierId, p_amount: 1000,
    });
    expect(error).not.toBeNull();
  });

  it("a non-owner cannot record an opening balance", async () => {
    const { data: s2 } = await adminClient().from("suppliers").insert({ name: `OB2 ${Date.now()}` }).select("id").single();
    const { error } = await mgr.client.rpc("record_opening_balance", {
      p_supplier_id: s2!.id as string, p_amount: 5000,
    });
    expect(error).not.toBeNull();
  });
});
