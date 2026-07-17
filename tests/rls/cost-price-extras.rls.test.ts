import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// A mixing batch can include external (non-stock) materials that count toward
// the weighted cost price but are never stock.
describe("cost-price run extras", () => {
  let newSite: string, monazite: string, supplierId: string;
  let gm: TestUser, siteMgr: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    gm = await makeUser({ username: "cpe-gm", role: "manager", siteId: newSite });
    siteMgr = await makeUser({ username: "cpe-sm", role: "manager", siteId: sites!.find((s) => s.name !== "New-Site")!.id as string });
    recv = await makeUser({ username: "cpe-recv", role: "receiving", siteId: newSite });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `CPE ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
  });

  async function run() {
    const { data } = await adminClient().from("cost_price_runs")
      .insert({ site_id: newSite, label: `Run ${Date.now()}-${Math.random()}`, created_by: gm.userId }).select("id").single();
    return data!.id as string;
  }
  async function lot(weight: number, cost: number) {
    const { data } = await adminClient().from("stock_lots")
      .insert({ site_id: newSite, material_type_id: monazite, supplier_id: supplierId, weight_kg: weight, cost_price_per_kg: cost, recorded_by: recv.userId })
      .select("id").single();
    return data!.id as string;
  }
  const totals = async (id: string) => (await adminClient().from("cost_price_runs").select("total_weight_kg, total_cost_price, avg_cost_price_per_kg").eq("id", id).single()).data!;

  it("extras count toward the weighted cost price alongside stocked lots", async () => {
    const rid = await run();
    const l = await lot(100, 20); // 100kg @ ₦20 = ₦2000
    await adminClient().from("cost_price_run_lots").insert({ run_id: rid, stock_lot_id: l });
    let t = await totals(rid);
    expect(Number(t.total_weight_kg)).toBe(100);
    expect(Number(t.avg_cost_price_per_kg)).toBe(20);

    // GM adds an external material: 100kg @ ₦40 = ₦4000. Combined weighted = 6000/200 = ₦30.
    const ins = await gm.client.from("cost_price_run_extras").insert({ run_id: rid, material_name: "Bought tin", weight_kg: 100, cost_price_per_kg: 40 });
    expect(ins.error).toBeNull();
    t = await totals(rid);
    expect(Number(t.total_weight_kg)).toBe(200);
    expect(Number(t.total_cost_price)).toBe(6000);
    expect(Number(t.avg_cost_price_per_kg)).toBe(30);
  });

  it("a site manager cannot add extras", async () => {
    const rid = await run();
    expect((await siteMgr.client.from("cost_price_run_extras").insert({ run_id: rid, material_name: "x", weight_kg: 10, cost_price_per_kg: 1 })).error).not.toBeNull();
  });
});
