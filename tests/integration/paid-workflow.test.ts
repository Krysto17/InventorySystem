import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Owner approves; only the accountant marks paid. Advances and expenses gain a
// 'paid' step after owner approval.
describe("paid workflow (owner approves → accountant pays)", () => {
  let siteId: string;
  let mgr: TestUser, owner: TestUser, acct: TestUser;
  let supplierId: string;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    mgr   = await makeUser({ username: "pw-mgr",  role: "manager",    siteId });
    owner = await makeUser({ username: "pw-owner", role: "owner",     siteId: null });
    acct  = await makeUser({ username: "pw-acct", role: "accounting", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "PaidFlow Supplier" }).select("id").single();
    supplierId = s!.id as string;
  });

  it("advance: owner approves; manager (cash) marks paid; debt counts paid", async () => {
    const { data: a } = await mgr.client.from("advances").insert({
      supplier_id: supplierId, site_id: siteId, purpose: "Float", amount_naira: 40000, recorded_by: mgr.userId,
    }).select("id").single();

    // Manager cannot approve
    expect((await mgr.client.from("advances").update({ approval_status: "approved" }).eq("id", a!.id)).error).not.toBeNull();
    // Owner approves
    expect((await owner.client.from("advances").update({ approval_status: "approved" }).eq("id", a!.id)).error).toBeNull();

    // Manager marks paid — cash payouts are often made by the manager (0101).
    expect((await mgr.client.from("advances").update({ approval_status: "paid" }).eq("id", a!.id)).error).toBeNull();

    const { data: row } = await adminClient().from("advances").select("approval_status, paid_by").eq("id", a!.id).single();
    expect(row!.approval_status).toBe("paid");
    expect(row!.paid_by).toBe(mgr.userId);

    // A paid advance still counts as supplier debt
    const { data: debt } = await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId });
    expect(Number(debt)).toBe(40000);
  });

  it("expense: manager logs (pending) → owner approves → manager marks paid", async () => {
    const { data: e } = await mgr.client.from("consumables").insert({
      site_id: siteId, name: "Diesel", category: "fuel_lubricants", amount_naira: 12000, recorded_by: mgr.userId,
    }).select("id, approval_status").single();
    expect(e!.approval_status).toBe("pending");

    // Accountant cannot approve
    expect((await acct.client.from("consumables").update({ approval_status: "approved" }).eq("id", e!.id)).error).not.toBeNull();
    // Owner approves
    expect((await owner.client.from("consumables").update({ approval_status: "approved" }).eq("id", e!.id)).error).toBeNull();
    // Manager marks paid — allowed since Phase-0101 (cash payouts by the manager).
    expect((await mgr.client.from("consumables").update({ approval_status: "paid" }).eq("id", e!.id)).error).toBeNull();

    const { data: row } = await adminClient().from("consumables").select("approval_status, paid_by").eq("id", e!.id).single();
    expect(row!.approval_status).toBe("paid");
    expect(row!.paid_by).toBe(mgr.userId);
  });
});
