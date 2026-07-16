import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A light bill on a dressing-only (no-supply) visit is carried to the customer's
// account, joins their outstanding balance, and is recovered like an advance.
describe("carried light bills + dressing-only close", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, mgr: TestUser, inv: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "lb-owner", role: "owner", siteId: null });
    mgr = await makeUser({ username: "lb-mgr", role: "manager", siteId });
    inv = await makeUser({ username: "lb-inv", role: "inventory", siteId });
    recv = await makeUser({ username: "lb-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `LB ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function processedVisit(bill = 5000) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "unprocessed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("utility_charges").insert({
      visit_id: v!.id, kind: "light_bill", description: "Dressing", amount: bill, recorded_by: recv.userId,
    });
    return v!.id as string;
  }
  const debt = async () => Number((await adminClient().rpc("supplier_outstanding_debt", { _supplier_id: supplierId })).data ?? 0);

  it("dressing-only close carries the light bill into the customer balance", async () => {
    const before = await debt();
    const id = await processedVisit(5000);
    const { error } = await mgr.client.rpc("close_dressing_only", { p_visit_id: id });
    expect(error).toBeNull();

    const v = (await adminClient().from("visits").select("state, dressing_only").eq("id", id).single()).data!;
    expect(v.state).toBe("exited");
    expect(v.dressing_only).toBe(true);
    const uc = (await adminClient().from("utility_charges").select("carried").eq("visit_id", id).single()).data!;
    expect(uc.carried).toBe(true);
    expect(await debt()).toBe(before + 5000);
  });

  it("the carried balance is recovered like an advance (deduction clears it)", async () => {
    const start = await debt();
    const { error } = await mgr.client.from("advance_deductions").insert({
      supplier_id: supplierId, site_id: siteId, amount: start, notes: "Recovered from New-Site supply", recorded_by: mgr.userId,
    });
    expect(error).toBeNull();
    expect(await debt()).toBe(0);
  });

  it("inventory cannot close a visit as dressing-only", async () => {
    const id = await processedVisit();
    expect((await inv.client.rpc("close_dressing_only", { p_visit_id: id })).error).not.toBeNull();
  });

  it("a visit with a settlement cannot be closed as dressing-only", async () => {
    const id = await processedVisit();
    await adminClient().from("batch_settlements").insert({
      visit_id: id, site_id: siteId, materials_total: 0, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 0, submitted_by: recv.userId, status: "approved",
    });
    expect((await mgr.client.rpc("close_dressing_only", { p_visit_id: id })).error).not.toBeNull();
  });

  it("closing needs a light bill on the visit", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "unprocessed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    expect((await mgr.client.rpc("close_dressing_only", { p_visit_id: v!.id })).error).not.toBeNull();
  });
});
