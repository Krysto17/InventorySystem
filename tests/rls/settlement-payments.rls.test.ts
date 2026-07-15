import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Part payments + cash paid by the manager. record_settlement_payment logs a
// payment and derives the settlement status (approved → partially_paid → paid).
describe("settlement payments (part / full, manager cash)", () => {
  let siteId: string, otherSite: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, mgr: TestUser, mgrOther: TestUser, recv: TestUser, inv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    otherSite = sites!.find((s) => s.name !== "New-Site" && s.id !== siteId)!.id as string;
    owner = await makeUser({ username: "pay-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "pay-acct", role: "accounting", siteId });
    mgr = await makeUser({ username: "pay-mgr", role: "manager", siteId });
    mgrOther = await makeUser({ username: "pay-mgr2", role: "manager", siteId: otherSite });
    recv = await makeUser({ username: "pay-recv", role: "receiving", siteId });
    inv = await makeUser({ username: "pay-inv", role: "inventory", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `Pay ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  // An approved (unpaid) settlement of net 10,000 with one 100kg line.
  async function approvedSettlement(net = 10000) {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 100, unit_price: net / 100,
      requires_analysis: false, recorded_by: recv.userId,
    });
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: net, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: net, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    return { visitId: v!.id as string, settlementId: bs!.id as string };
  }

  async function status(id: string) {
    const { data } = await adminClient().from("batch_settlements").select("status").eq("id", id).single();
    return data!.status as string;
  }

  it("manager cash part payment → partially_paid; full remainder → paid", async () => {
    const { settlementId, visitId } = await approvedSettlement(10000);
    const p1 = await mgr.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 4000, p_method: "cash" });
    expect(p1.error).toBeNull();
    expect(await status(settlementId)).toBe("partially_paid");

    const p2 = await acct.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 6000, p_method: "transfer" });
    expect(p2.error).toBeNull();
    expect(await status(settlementId)).toBe("paid");

    // Full payment tips stock intake → the visit is stocked.
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("stocked");
    const { data: pays } = await adminClient().from("settlement_payments").select("amount").eq("settlement_id", settlementId);
    expect(pays!.length).toBe(2);
  });

  it("blocks a payment that exceeds the remaining balance", async () => {
    const { settlementId } = await approvedSettlement(10000);
    await mgr.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 7000, p_method: "cash" });
    const { error } = await mgr.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 4000, p_method: "cash" });
    expect(error).not.toBeNull();
    expect(await status(settlementId)).toBe("partially_paid");
  });

  it("a manager on another site cannot pay this settlement", async () => {
    const { settlementId } = await approvedSettlement();
    const { error } = await mgrOther.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100, p_method: "cash" });
    expect(error).not.toBeNull();
  });

  it("inventory cannot record a payment", async () => {
    const { settlementId } = await approvedSettlement();
    const { error } = await inv.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100, p_method: "cash" });
    expect(error).not.toBeNull();
  });

  it("a held settlement takes no payment", async () => {
    const { settlementId } = await approvedSettlement();
    await owner.client.rpc("hold_settlement", { p_id: settlementId });
    const { error } = await mgr.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 100, p_method: "cash" });
    expect(error).not.toBeNull();
  });

  it("a fully paid settlement takes no further payment", async () => {
    const { settlementId } = await approvedSettlement(5000);
    await acct.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 5000, p_method: "transfer" });
    const { error } = await mgr.client.rpc("record_settlement_payment", { p_settlement_id: settlementId, p_amount: 1, p_method: "cash" });
    expect(error).not.toBeNull();
  });
});
