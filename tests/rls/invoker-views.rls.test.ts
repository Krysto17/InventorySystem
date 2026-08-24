import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// stocked_materials and site_rollups used to run with their owner's rights,
// bypassing RLS. They now run as the caller — which must not cost the store
// keeper the one thing their whole screen depends on: knowing a lot is paid for.
describe("the flat views run as the caller", () => {
  let siteA: string, siteB: string, material: string, supplierId: string, lotId: string;
  let keeper: TestUser, owner: TestUser, mgrB: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site" && s.id !== siteA)!.id as string;
    keeper = await makeUser({ username: "iv-keeper", role: "stock_keeper", siteId: siteA });
    owner = await makeUser({ username: "iv-owner", role: "owner", siteId: null });
    mgrB = await makeUser({ username: "iv-mgr-b", role: "manager", siteId: siteB });
    recv = await makeUser({ username: "iv-recv", role: "receiving", siteId: siteA });

    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: `IV ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `IV-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;

    // A real paid batch, so the lot carries a genuine paid state.
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteA, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "awaiting_stock_intake", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: material, weight_kg: 70, unit_price: 100,
    });
    const { data: st } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteA, materials_total: 7000, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 7000,
      submitted_by: recv.userId, status: "approved",
    }).select("id").single();
    await adminClient().from("batch_settlements")
      .update({ status: "paid", paid_by: owner.userId }).eq("id", st!.id);

    const { data: lot } = await adminClient().from("stock_lots")
      .select("id").eq("material_type_id", material).eq("status", "available").single();
    lotId = lot!.id as string;
  });

  it("the store keeper still sees their stock, and still sees it as paid", async () => {
    const { data } = await keeper.client.from("stocked_materials")
      .select("id, is_paid, material_name, supplier_name").eq("id", lotId);
    expect(data).toHaveLength(1);
    expect(data![0].is_paid).toBe(true);      // the whole store check depends on this
    expect(data![0].material_name).toBeTruthy();
    // Supplier stays out of reach — bank details live on that table.
    expect(data![0].supplier_name).toBeNull();
  });

  it("and can still count it", async () => {
    expect((await keeper.client.rpc("record_stock_check", {
      p_lot_id: lotId, p_status: "confirmed", p_counted_weight: 70,
    })).error).toBeNull();
  });

  it("the owner sees the supplier name the keeper cannot", async () => {
    const { data } = await owner.client.from("stocked_materials")
      .select("supplier_name, is_paid").eq("id", lotId).single();
    expect(data!.supplier_name).toBeTruthy();
    expect(data!.is_paid).toBe(true);
  });

  it("a manager on another site does not see this lot at all", async () => {
    const { data } = await mgrB.client.from("stocked_materials").select("id").eq("id", lotId);
    expect(data ?? []).toHaveLength(0);
  });

  // A paid supply is not un-paid in place — the state machine refuses that.
  // reverse_paid_supply removes the lot and the settlement together, so the
  // guarantee to assert is that the lot leaves the log entirely.
  it("reversing a paid supply takes the lot out of the log", async () => {
    const { data: lot } = await adminClient().from("stock_lots")
      .select("ref_visit_material_id").eq("id", lotId).single();
    const { data: vm } = await adminClient().from("visit_materials")
      .select("visit_id").eq("id", lot!.ref_visit_material_id!).single();

    const { error } = await owner.client.rpc("reverse_paid_supply", {
      p_visit_id: vm!.visit_id, p_reason: "Refund confirmed by bank",
    });
    expect(error).toBeNull();

    const { data } = await adminClient().from("stocked_materials").select("id").eq("id", lotId);
    expect(data ?? []).toHaveLength(0);
  });

  // The flag itself is maintained on any status change, so the denormalised
  // copy cannot drift from the settlement it mirrors.
  it("keeps the lot's paid flag in step with its settlement", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteA, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "awaiting_stock_intake", created_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: material, weight_kg: 12, unit_price: 50,
    });
    const { data: st } = await adminClient().from("batch_settlements").insert({
      visit_id: v!.id, site_id: siteA, materials_total: 600, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 600,
      submitted_by: recv.userId, status: "approved",
    }).select("id").single();
    await adminClient().from("batch_settlements")
      .update({ status: "paid", paid_by: owner.userId }).eq("id", st!.id);

    const { data: lots } = await adminClient().from("stock_lots")
      .select("batch_paid").eq("ref_visit_material_id",
        (await adminClient().from("visit_materials").select("id").eq("visit_id", v!.id).single()).data!.id);
    expect(lots!.every((l) => l.batch_paid === true)).toBe(true);
  });

  it("site_rollups stays for cross-site readers only", async () => {
    expect((await owner.client.from("site_rollups").select("site_id")).data!.length).toBeGreaterThan(0);
    expect((await mgrB.client.from("site_rollups").select("site_id")).data ?? []).toHaveLength(0);
    expect((await keeper.client.from("site_rollups").select("site_id")).data ?? []).toHaveLength(0);
  });
});
