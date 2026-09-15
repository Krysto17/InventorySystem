import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * 0154: the inventory employee reads stock at every site.
 *
 * Reported as "some materials for cost price are not available on the inventory
 * employee dashboard". Nothing was broken in the screen: 0149 had scoped
 * inventory's stock READ to its own site, and both production inventory
 * accounts are posted at New-Site, while 143 of the 489 available lots sat at
 * Old-Site — a site with no inventory account at all. 15 of the 32 real mixing
 * batches combine lots from two sites, so the general manager could form them
 * and the inventory employee could not even see the material.
 *
 * The ruling widened READ only. These tests pin both halves: inventory now sees
 * and mixes another site's stock, and every inventory write — and every other
 * site-bound role's read — is exactly as scoped as before.
 */
describe("inventory reads stock across sites (0154)", () => {
  const rid = Date.now().toString(36);
  let newSite: string, oldSite: string, materialId: string, supplierId: string;
  let inv: TestUser, keeper: TestUser, owner: TestUser;

  async function makeLot(site: string, weight: number, cost: number) {
    const admin = adminClient();
    const { data: lot, error } = await admin.from("stock_lots").insert({
      site_id: site, material_type_id: materialId, supplier_id: supplierId,
      weight_kg: weight, cost_price_per_kg: cost, status: "available", recorded_by: owner.userId,
    }).select("id").single();
    expect(error, `lot fixture: ${error?.message}`).toBeNull();
    await admin.from("stock_movements").insert({
      site_id: site, material_type_id: materialId, weight, direction: "in",
      recorded_by: owner.userId, reason: "purchase_intake",
    });
    return lot!.id as string;
  }

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    newSite = sites!.find((s) => s.name === "New-Site")!.id as string;
    oldSite = sites!.find((s) => s.name === "Old-Site")!.id as string;
    // Its own material type, so these buckets are nobody else's.
    const { data: mt } = await admin.from("material_types")
      .insert({ name: `XS Stock ${rid}` }).select("id").single();
    materialId = mt!.id as string;
    const { data: sup } = await admin.from("suppliers")
      .insert({ name: `XS Supplier ${rid}` }).select("id").single();
    supplierId = sup!.id as string;
    // Posted exactly as production is: inventory at New-Site.
    inv = await makeUser({ username: `xs-inv-${rid}`, role: "inventory", siteId: newSite });
    keeper = await makeUser({ username: `xs-sk-${rid}`, role: "stock_keeper", siteId: newSite });
    owner = await makeUser({ username: `xs-own-${rid}`, role: "owner", siteId: null });
  });

  afterAll(async () => {
    await adminClient().from("stock_movements").delete().eq("material_type_id", materialId);
  });

  it("inventory at New-Site sees an Old-Site lot — the reported defect", async () => {
    const lot = await makeLot(oldSite, 40, 25);
    const { data, error } = await inv.client.from("stock_lots").select("id").eq("id", lot);
    expect(error).toBeNull();
    expect(data ?? [], "the Old-Site lot must be visible to inventory").toHaveLength(1);
  });

  it("the cost-price lot query returns both sites' stock to inventory", async () => {
    const a = await makeLot(newSite, 10, 30);
    const b = await makeLot(oldSite, 10, 30);
    // The shape CostPriceModule asks for.
    const { data, error } = await inv.client.from("stock_lots")
      .select("id, site:sites(name)")
      .eq("status", "available").eq("material_type_id", materialId)
      .order("created_at", { ascending: false }).order("id", { ascending: false });
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids, "New-Site lot").toContain(a);
    expect(ids, "Old-Site lot").toContain(b);
  });

  it("inventory mixes an Old-Site lot into its own batch, and the cost counts it", async () => {
    const mine = await makeLot(newSite, 100, 20);
    const theirs = await makeLot(oldSite, 100, 40);
    // The batch itself is still formed on inventory's own site.
    const { data: run, error } = await inv.client.from("cost_price_runs").insert({
      site_id: newSite, label: `XS mix ${rid}`, material_type_id: materialId,
      approval_status: "pending", created_by: inv.userId,
    }).select("id").single();
    expect(error, `run: ${error?.message}`).toBeNull();
    for (const lotId of [mine, theirs]) {
      const { error: linkErr } = await inv.client.from("cost_price_run_lots")
        .insert({ run_id: run!.id, stock_lot_id: lotId });
      expect(linkErr, `attach: ${linkErr?.message}`).toBeNull();
    }
    const { data: row } = await adminClient().from("cost_price_runs")
      .select("avg_cost_price_per_kg, total_weight_kg").eq("id", run!.id).single();
    expect(Number(row!.total_weight_kg), "both lots' weight").toBe(200);
    expect(Number(row!.avg_cost_price_per_kg), "(100*20 + 100*40) / 200").toBe(30);
  });

  it("inventory sees another site's balance as that site's own bucket", async () => {
    await makeLot(oldSite, 15, 10);
    const { data } = await inv.client.from("stock_balances")
      .select("site_id").eq("material_type_id", materialId);
    const sitesSeen = new Set((data ?? []).map((r) => r.site_id));
    expect(sitesSeen.has(oldSite), "Old-Site bucket visible").toBe(true);
    expect(sitesSeen.has(newSite), "New-Site bucket visible, separately").toBe(true);
  });

  // ── Read only: every write stays exactly as scoped as before ─────────────
  it("inventory still cannot form a batch ON another site", async () => {
    const { error } = await inv.client.from("cost_price_runs").insert({
      site_id: oldSite, label: `XS wrong site ${rid}`, created_by: inv.userId,
    });
    expect(error, "a run is still anchored to inventory's own site").not.toBeNull();
  });

  it("inventory still cannot write another site's stock ledger", async () => {
    const { error } = await inv.client.from("stock_movements").insert({
      site_id: oldSite, material_type_id: materialId, weight: 1, direction: "in",
      recorded_by: inv.userId, reason: "purchase_intake",
    });
    expect(error, "stock intake stays own-site").not.toBeNull();
  });

  it("other site-bound roles are unchanged — the store keeper still sees one store", async () => {
    const lot = await makeLot(oldSite, 5, 5);
    const { data } = await keeper.client.from("stock_lots").select("id").eq("id", lot);
    expect(data ?? [], "the widening is for inventory only").toHaveLength(0);
  });
});
