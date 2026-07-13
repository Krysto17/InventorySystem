import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A supplier payment (batch settlement) must be approved by the director (owner)
// before it reaches the accountant's to-pay queue. A manager can't approve it.
describe("settlement director approval", () => {
  let siteId: string, monaziteId: string, visitId: string, settlementId: string;
  let owner: TestUser, mgr: TestUser, acct: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    owner = await makeUser({ username: "sda-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "sda-mgr", role: "manager", siteId });
    acct = await makeUser({ username: "sda-acct", role: "accounting", siteId });
    recv = await makeUser({ username: "sda-recv", role: "receiving", siteId });
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
    const { data: sup } = await adminClient().from("suppliers").insert({ name: `SDA ${Date.now()}` }).select("id").single();
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: sup!.id, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    visitId = v!.id as string;
    // A pending settlement (as submitBatchSettlement now creates it).
    const { data: s } = await adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId, materials_total: 1000, light_bill_total: 0,
      advance_deducted: 0, net_balance: 1000, submitted_by: mgr.userId, status: "pending",
    }).select("id").single();
    settlementId = s!.id as string;
  });

  const acctToPay = () => acct.client.from("batch_settlements").select("id").eq("status", "approved").eq("id", settlementId);

  it("a pending payment does not appear in the accountant's to-pay queue", async () => {
    const { data } = await acctToPay();
    expect(data ?? []).toHaveLength(0);
  });

  it("a manager cannot approve the payment", async () => {
    await mgr.client.from("batch_settlements").update({ status: "approved" }).eq("id", settlementId);
    const { data } = await adminClient().from("batch_settlements").select("status").eq("id", settlementId).single();
    expect(data!.status).toBe("pending"); // still pending
  });

  it("after the owner approves, it appears in the accountant's queue", async () => {
    const { error } = await owner.client.from("batch_settlements").update({ status: "approved" }).eq("id", settlementId);
    expect(error).toBeNull();
    const { data: after } = await adminClient().from("batch_settlements").select("status, approved_by").eq("id", settlementId).single();
    expect(after!.status).toBe("approved");
    expect(after!.approved_by).toBe(owner.userId);

    const { data } = await acctToPay();
    expect(data ?? []).toHaveLength(1);
  });
});
