import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The dashboards used to sum the raw ledger in JavaScript, which PostgREST
// truncates at max_rows (1000) without saying so — past a thousand movements
// the stock figures quietly stopped matching what was at hand. These views
// aggregate in the database, so the answer is right at any ledger size.
describe("stock balances aggregate in the database", () => {
  let siteA: string, siteB: string, material: string;
  let owner: TestUser, invA: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteA = sites!.find((s) => s.name !== "New-Site")!.id as string;
    siteB = sites!.find((s) => s.name !== "New-Site" && s.id !== siteA)!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Balance-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
    owner = await makeUser({ username: "sb-owner", role: "owner", siteId: null });
    invA = await makeUser({ username: "sb-inv", role: "inventory", siteId: siteA });
  });

  it("stays correct past PostgREST's 1000-row cap", async () => {
    // 1200 intakes of 1kg, then 200kg back out: 1000kg must remain.
    const rows = Array.from({ length: 1200 }, () => ({
      site_id: siteA, material_type_id: material, weight: 1,
      direction: "in", recorded_by: invA.userId, reason: "purchase_intake",
    }));
    expect((await adminClient().from("stock_movements").insert(rows)).error).toBeNull();
    expect((await adminClient().from("stock_movements").insert({
      site_id: siteA, material_type_id: material, weight: 200,
      direction: "out", recorded_by: invA.userId, reason: "bulk_sale",
    })).error).toBeNull();

    // Summing the raw ledger the old way loses everything past row 1000.
    const { data: raw } = await owner.client.from("stock_movements")
      .select("weight, direction").eq("material_type_id", material);
    expect(raw!.length).toBeLessThan(1201); // truncated by max_rows

    const { data: balances } = await owner.client.from("stock_balances")
      .select("weight_kg").eq("material_type_id", material);
    const total = (balances ?? []).reduce((s, b) => s + Number(b.weight_kg), 0);
    expect(total).toBe(1000);
  });

  it("drops a bucket once it is fully sold", async () => {
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Sold-Out ${Date.now()}` }).select("id").single();
    const sold = mt!.id as string;
    await adminClient().from("stock_movements").insert([
      { site_id: siteA, material_type_id: sold, weight: 50, direction: "in", recorded_by: invA.userId, reason: "purchase_intake" },
      { site_id: siteA, material_type_id: sold, weight: 50, direction: "out", recorded_by: invA.userId, reason: "bulk_sale" },
    ]);
    const { data } = await owner.client.from("stock_balances").select("weight_kg").eq("material_type_id", sold);
    expect(data ?? []).toHaveLength(0);
  });

  it("keeps each site's stock in its own bucket, and scopes by role", async () => {
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Two-Site ${Date.now()}` }).select("id").single();
    const twoSite = mt!.id as string;
    await adminClient().from("stock_movements").insert([
      { site_id: siteA, material_type_id: twoSite, weight: 10, direction: "in", recorded_by: invA.userId, reason: "purchase_intake" },
      { site_id: siteB, material_type_id: twoSite, weight: 25, direction: "in", recorded_by: invA.userId, reason: "purchase_intake" },
    ]);

    const { data: all } = await owner.client.from("stock_balances").select("site_id, weight_kg").eq("material_type_id", twoSite);
    expect(all).toHaveLength(2);

    // The site's own inventory role sees only its own site.
    const { data: mine } = await invA.client.from("stock_balances").select("site_id, weight_kg").eq("material_type_id", twoSite);
    expect(mine).toHaveLength(1);
    expect(mine![0].site_id).toBe(siteA);
    expect(Number(mine![0].weight_kg)).toBe(10);
  });

  it("values the material at hand, ignoring lots with no recorded cost", async () => {
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Costed ${Date.now()}` }).select("id").single();
    const costed = mt!.id as string;
    await adminClient().from("stock_lots").insert([
      { site_id: siteA, material_type_id: costed, weight_kg: 100, cost_price_per_kg: 500, status: "available" },
      { site_id: siteA, material_type_id: costed, weight_kg: 40, cost_price_per_kg: null, status: "available" },
      { site_id: siteA, material_type_id: costed, weight_kg: 900, cost_price_per_kg: 9, status: "sold" },
    ]);
    const { data } = await owner.client.from("material_cost_basis")
      .select("cost_per_kg, uncosted_kg").eq("material_type_id", costed).single();
    expect(Number(data!.cost_per_kg)).toBe(500); // the uncosted 40kg does not drag it down
    expect(Number(data!.uncosted_kg)).toBe(40);
  });
});

// Marking a batch paid used to stock every line on it. Material released back
// to the supplier on a gate pass, and material no price was ever agreed on,
// are not stock — the company never bought them.
describe("only bought material becomes stock", () => {
  let siteId: string, supplierId: string, material: string;
  let owner: TestUser, recv: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    owner = await makeUser({ username: "ob-owner", role: "owner", siteId: null });
    recv = await makeUser({ username: "ob-recv", role: "receiving", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `OB ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Intake-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
  });

  it("stocks the priced, settled line only", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "awaiting_stock_intake", created_by: recv.userId,
    }).select("id").single();
    const visitId = v!.id as string;

    await adminClient().from("visit_materials").insert([
      { visit_id: visitId, material_type_id: material, weight_kg: 100, unit_price: 50, settlement_status: "settled" },
      { visit_id: visitId, material_type_id: material, weight_kg: 40, unit_price: 50, settlement_status: "unsettled" },
      { visit_id: visitId, material_type_id: material, weight_kg: 25, unit_price: null, settlement_status: "settled" },
    ]);

    const { data: st } = await adminClient().from("batch_settlements").insert({
      visit_id: visitId, site_id: siteId, materials_total: 5000, light_bill_total: 0,
      other_deductions_total: 0, advance_deducted: 0, net_balance: 5000,
      submitted_by: recv.userId, status: "approved",
    }).select("id").single();
    await adminClient().from("batch_settlements").update({ status: "paid", paid_by: owner.userId }).eq("id", st!.id);

    // Only the 100kg priced+settled line is stock.
    const { data: bal } = await owner.client.from("stock_balances").select("weight_kg").eq("material_type_id", material);
    expect((bal ?? []).reduce((s, b) => s + Number(b.weight_kg), 0)).toBe(100);

    const { data: lots } = await adminClient().from("stock_lots")
      .select("weight_kg").eq("material_type_id", material).eq("status", "available");
    expect(lots).toHaveLength(1);
    expect(Number(lots![0].weight_kg)).toBe(100);

    // The batch still leaves the intake queue.
    const { data: after } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(after!.state).toBe("stocked");
  });
});
