import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The accountant reverses a paid supply (supplier refund): the intake rolls out
// of stock, the settlement is voided, and the visit returns to pricing. Blocked
// once any of the material has left stock.
describe("reverse a paid supply", () => {
  let siteId: string, monazite: string, supplierId: string;
  let owner: TestUser, acct: TestUser, mgr: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "rev-owner", role: "owner", siteId: null });
    acct = await makeUser({ username: "rev-acct", role: "accounting", siteId });
    mgr = await makeUser({ username: "rev-mgr", role: "manager", siteId });
    recv = await makeUser({ username: "rev-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `Rev ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  // Build a PAID, stocked supply by recording the full payment (fires intake).
  async function paidSupply() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "processed", state: "in_accounting", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monazite, weight_kg: 100, unit_price: 50, price_finalized: true,
      requires_analysis: false, recorded_by: recv.userId,
    });
    const { data: bs } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteId, materials_total: 5000, light_bill_total: 0, other_deductions_total: 0,
      advance_deducted: 0, net_balance: 5000, submitted_by: recv.userId,
      status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString(),
    }).select("id").single();
    await acct.client.rpc("record_settlement_payment", { p_settlement_id: bs!.id, p_amount: 5000, p_method: "transfer" });
    return { visitId: v!.id as string, settlementId: bs!.id as string };
  }

  it("reverses: stock rolled back, settlement voided, visit back to pricing", async () => {
    const { visitId, settlementId } = await paidSupply();
    // Confirm it stocked first.
    expect((await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state).toBe("stocked");
    expect((await adminClient().from("stock_lots").select("id, ref:visit_materials!inner(visit_id)").eq("visit_materials.visit_id", visitId)).data!.length).toBeGreaterThan(0);

    const { error } = await acct.client.rpc("reverse_paid_supply", { p_visit_id: visitId, p_reason: "supplier refunded" });
    expect(error).toBeNull();

    expect((await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state).toBe("pricing");
    expect((await adminClient().from("batch_settlements").select("id").eq("id", settlementId)).data!.length).toBe(0);
    const { data: lots } = await adminClient().from("stock_lots").select("id, ref:visit_materials!inner(visit_id)").eq("visit_materials.visit_id", visitId);
    expect(lots!.length).toBe(0);
    const { data: lines } = await adminClient().from("visit_materials").select("price_finalized").eq("visit_id", visitId);
    expect(lines!.every((l) => l.price_finalized === false)).toBe(true);
  });

  it("blocks reversal once the material has been sold", async () => {
    const { visitId } = await paidSupply();
    // Mark a lot sold — simulating it having left stock.
    await adminClient().from("stock_lots").update({ status: "sold" })
      .in("ref_visit_material_id", (await adminClient().from("visit_materials").select("id").eq("visit_id", visitId)).data!.map((m) => m.id));
    const { error } = await acct.client.rpc("reverse_paid_supply", { p_visit_id: visitId, p_reason: "too late" });
    expect(error).not.toBeNull();
    expect((await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state).toBe("stocked");
  });

  it("a manager cannot reverse a paid supply", async () => {
    const { visitId } = await paidSupply();
    expect((await mgr.client.rpc("reverse_paid_supply", { p_visit_id: visitId, p_reason: "nope" })).error).not.toBeNull();
  });
});
