import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 11 (F): saved weighted cost-price computations over stock lots
// (mixing materials is allowed, per the blueprint).
describe("cost-price runs", () => {
  let siteAId: string, siteBId: string;
  let mgr: TestUser, acct: TestUser, proc: TestUser;
  let monaziteId: string, zirconId: string, supplierId: string;

  async function newLot(materialId: string, weight: number, cost: number) {
    const { data, error } = await adminClient().from("stock_lots").insert({
      site_id: siteAId, material_type_id: materialId, supplier_id: supplierId,
      weight_kg: weight, cost_price_per_kg: cost,
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    mgr  = await makeUser({ username: "cpr-mgr",  role: "manager",    siteId: siteAId });
    acct = await makeUser({ username: "cpr-acct", role: "accounting", siteId: siteBId });
    proc = await makeUser({ username: "cpr-proc", role: "processing", siteId: siteAId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "CPR Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    const { data: zr } = await adminClient().from("material_types").select("id").eq("name", "Zircon").single();
    monaziteId = mz!.id as string;
    zirconId = zr!.id as string;
  });

  it("manager combines mixed-material lots into a weighted cost price", async () => {
    const lot1 = await newLot(monaziteId, 100, 200); // 20,000
    const lot2 = await newLot(zirconId, 50, 800);    // 40,000

    const { data: run, error } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Mixed batch Q2", created_by: mgr.userId,
    }).select("id").single();
    expect(error).toBeNull();

    for (const lotId of [lot1, lot2]) {
      const { error: iErr } = await mgr.client.from("cost_price_run_lots")
        .insert({ run_id: run!.id, stock_lot_id: lotId });
      expect(iErr).toBeNull();
    }

    const { data: after } = await adminClient().from("cost_price_runs")
      .select("total_weight_kg, total_cost_price, avg_cost_price_per_kg").eq("id", run!.id).single();
    expect(Number(after!.total_weight_kg)).toBe(150);
    expect(Number(after!.total_cost_price)).toBe(60000);
    expect(Number(after!.avg_cost_price_per_kg)).toBe(400); // 60,000 / 150
  });

  it("a run does NOT mark its lots as sold", async () => {
    const lot = await newLot(monaziteId, 10, 100);
    const { data: run } = await mgr.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "No-sale check", created_by: mgr.userId,
    }).select("id").single();
    await mgr.client.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot });
    const { data: l } = await adminClient().from("stock_lots").select("status").eq("id", lot).single();
    expect(l!.status).toBe("available");
  });

  it("accountant at another site can READ runs (cross-site reporting) but not create for site A", async () => {
    const { data } = await acct.client.from("cost_price_runs").select("id");
    expect(data!.length).toBeGreaterThan(0);

    const { error } = await acct.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Cross-site hack", created_by: acct.userId,
    });
    expect(error).not.toBeNull();
  });

  it("processing cannot create runs", async () => {
    const { error } = await proc.client.from("cost_price_runs").insert({
      site_id: siteAId, label: "Proc hack", created_by: proc.userId,
    });
    expect(error).not.toBeNull();
  });
});
