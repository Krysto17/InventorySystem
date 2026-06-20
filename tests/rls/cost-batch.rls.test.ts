import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Manager-formed mixing batches: forming a SOLD batch removes each lot from
// stock (flip to sold + 'mixed_batch' ledger 'out') and records weighted cost.
describe("cost-price mixing batch sells stock", () => {
  const rid = Date.now().toString(36);
  let siteAId: string, materialId: string, supplierId: string;
  let mgr: TestUser, inv: TestUser, owner: TestUser;

  async function makeLot(weight: number, cost: number) {
    const { data: lot } = await adminClient().from("stock_lots").insert({
      site_id: siteAId, material_type_id: materialId, supplier_id: supplierId,
      weight_kg: weight, cost_price_per_kg: cost, recorded_by: owner.userId,
    }).select("id").single();
    await adminClient().from("stock_movements").insert({
      site_id: siteAId, material_type_id: materialId, weight, direction: "in",
      recorded_by: owner.userId, reason: "purchase_intake",
    });
    return lot!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteAId = sites![0].id as string;
    const { data: mat } = await adminClient().from("material_types").select("id").limit(1).single();
    materialId = mat!.id as string;
    const { data: sup } = await adminClient()
      .from("suppliers").insert({ name: `CB Supplier ${rid}`, phone: "07" }).select("id").single();
    supplierId = sup!.id as string;
    mgr   = await makeUser({ username: `cb-mgr-${rid}`,   role: "manager",   siteId: siteAId });
    inv   = await makeUser({ username: `cb-inv-${rid}`,   role: "inventory", siteId: siteAId });
    owner = await makeUser({ username: `cb-owner-${rid}`, role: "owner",     siteId: null });
  });

  it("forming a sold batch flips lots to sold, writes mixed_batch out, computes avg", async () => {
    const lot1 = await makeLot(100, 50);
    const lot2 = await makeLot(200, 80);

    const { data: run, error: runErr } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Mixed monazite", material_type_id: materialId,
      sold: true, sold_at: new Date().toISOString(), created_by: mgr.userId,
    }).select("id").single();
    expect(runErr).toBeNull();

    for (const lotId of [lot1, lot2]) {
      const { error } = await mgr.client.from("cost_price_run_lots")
        .insert({ run_id: run!.id, stock_lot_id: lotId });
      expect(error).toBeNull();
    }

    const { data: lots } = await adminClient()
      .from("stock_lots").select("status").in("id", [lot1, lot2]);
    expect((lots ?? []).every((l) => l.status === "sold")).toBe(true);

    const { data: outs } = await adminClient()
      .from("stock_movements").select("weight, direction, reason")
      .eq("reason", "mixed_batch").in("weight", [100, 200]);
    expect((outs ?? []).filter((o) => o.direction === "out").length).toBeGreaterThanOrEqual(2);

    const { data: runRow } = await adminClient()
      .from("cost_price_runs").select("avg_cost_price_per_kg, total_weight_kg").eq("id", run!.id).single();
    expect(Number(runRow!.total_weight_kg)).toBe(300);
    expect(Number(runRow!.avg_cost_price_per_kg)).toBe(70); // (100*50 + 200*80)/300
  });

  it("a non-sold computation leaves lots available", async () => {
    const lot = await makeLot(50, 40);
    const { data: run } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Just a calc", sold: false, created_by: mgr.userId,
    }).select("id").single();
    await mgr.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot });
    const { data: l } = await adminClient().from("stock_lots").select("status").eq("id", lot).single();
    expect(l!.status).toBe("available");
  });

  it("attaching an already-sold lot is rejected", async () => {
    const lot = await makeLot(10, 10);
    const { data: run1 } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "first", sold: true, sold_at: new Date().toISOString(), created_by: mgr.userId,
    }).select("id").single();
    await mgr.client.from("cost_price_run_lots").insert({ run_id: run1!.id, stock_lot_id: lot });

    const { data: run2 } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "second", sold: true, sold_at: new Date().toISOString(), created_by: mgr.userId,
    }).select("id").single();
    const { error } = await mgr.client.from("cost_price_run_lots").insert({ run_id: run2!.id, stock_lot_id: lot });
    expect(error).not.toBeNull();
  });

  it("inventory cannot create a cost-price run", async () => {
    const { error } = await inv.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "nope", sold: true, created_by: inv.userId,
    });
    expect(error).not.toBeNull();
  });

  it("owner sees sold batches across sites", async () => {
    const { data } = await owner.client.from("cost_price_runs").select("id").eq("sold", true).limit(1);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
