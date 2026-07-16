import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A ₦0 (fully-covered) settlement can still be marked paid, which takes its
// materials into stock; a settlement with a balance left cannot be closed.
describe("close a ₦0 settlement", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, mgr: TestUser, recv: TestUser, inv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "cz-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "cz-acct", role: "accounting", siteId });
    mgr = await makeUser({ username: "cz-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "cz-recv", role: "receiving", siteId });
    inv = await makeUser({ username: "cz-inv", role: "inventory", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `CZ ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function settlement(net: number) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 40, unit_price: 0,
      requires_analysis: false, recorded_by: recv.userId,
    });
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: net, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: net, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return { visitId: v!.id as string, id: bs!.id as string };
  }

  it("accountant closes a ₦0 settlement → paid + materials stocked", async () => {
    const { id, visitId } = await settlement(0);
    const { error } = await acct.client.rpc("close_settlement", { p_id: id });
    expect(error).toBeNull();
    expect((await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!.status).toBe("paid");
    expect((await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state).toBe("stocked");
  });

  it("the manager can also close a ₦0 settlement", async () => {
    const { id } = await settlement(0);
    expect((await mgr.client.rpc("close_settlement", { p_id: id })).error).toBeNull();
  });

  it("a settlement with a balance left cannot be closed", async () => {
    const { id } = await settlement(5000);
    const { error } = await acct.client.rpc("close_settlement", { p_id: id });
    expect(error).not.toBeNull();
    expect((await adminClient().from("batch_settlements").select("status").eq("id", id).single()).data!.status).toBe("approved");
  });

  it("a held ₦0 settlement cannot be closed until released", async () => {
    const { id } = await settlement(0);
    await owner.client.rpc("hold_settlement", { p_id: id });
    expect((await acct.client.rpc("close_settlement", { p_id: id })).error).not.toBeNull();
  });

  it("inventory cannot close a settlement", async () => {
    const { id } = await settlement(0);
    expect((await inv.client.rpc("close_settlement", { p_id: id })).error).not.toBeNull();
  });
});
