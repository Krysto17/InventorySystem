import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 10 (C): manager + accountant get cross-site READ on reporting tables;
// writes remain site-scoped; other roles stay site-scoped for reads too.
describe("cross-site read RLS (manager + accountant)", () => {
  let siteAId: string, siteBId: string;
  let mgrA: TestUser, acctA: TestUser, procA: TestUser, invA: TestUser, siteMgrB: TestUser;
  let supplierId: string, materialTypeId: string, visitBId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    // Cross-site read now belongs to the GENERAL manager = the New-Site manager.
    siteAId = sites!.find((s) => s.name === "New-Site")!.id as string; // general mgr's site
    siteBId = sites!.find((s) => s.name !== "New-Site")!.id as string; // another site
    mgrA  = await makeUser({ username: "xsr-mgr-a",  role: "manager",    siteId: siteAId }); // general
    acctA = await makeUser({ username: "xsr-acct-a", role: "accounting", siteId: siteAId });
    procA = await makeUser({ username: "xsr-proc-a", role: "processing", siteId: siteAId });
    invA  = await makeUser({ username: "xsr-inv-a",  role: "inventory",  siteId: siteAId });
    // A SITE manager (not New-Site) — should NOT have cross-site read.
    siteMgrB = await makeUser({ username: "xsr-sitemgr-b", role: "manager", siteId: siteBId });

    const { data: s } = await adminClient().from("suppliers").insert({ name: "XSR Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;

    // Seed site B data: a visit, a stock movement, an advance, a stock lot.
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteBId, supplier_id: supplierId, declared_material_type_id: materialTypeId,
      entry_path: "processed", state: "in_receiving", created_by: mgrA.userId,
    }).select("id").single();
    visitBId = v!.id as string;
    await adminClient().from("stock_movements").insert({
      site_id: siteBId, material_type_id: materialTypeId, grade: "X",
      weight: 100, direction: "in", reason: "purchase_intake",
    });
    await adminClient().from("advances").insert({
      supplier_id: supplierId, site_id: siteBId, purpose: "XSR", amount_naira: 1000,
    });
    await adminClient().from("stock_lots").insert({
      site_id: siteBId, material_type_id: materialTypeId, supplier_id: supplierId,
      weight_kg: 10, cost_price_per_kg: 5,
    });
  });

  it("manager at site A reads site B visits, stock, lots, advances", async () => {
    const visits = await mgrA.client.from("visits").select("id").eq("site_id", siteBId);
    expect(visits.data!.length).toBeGreaterThan(0);
    const stock = await mgrA.client.from("stock_movements").select("id").eq("site_id", siteBId);
    expect(stock.data!.length).toBeGreaterThan(0);
    const lots = await mgrA.client.from("stock_lots").select("id").eq("site_id", siteBId);
    expect(lots.data!.length).toBeGreaterThan(0);
    const adv = await mgrA.client.from("advances").select("id").eq("site_id", siteBId);
    expect(adv.data!.length).toBeGreaterThan(0);
  });

  it("accountant at site A reads site B data too", async () => {
    const visits = await acctA.client.from("visits").select("id").eq("site_id", siteBId);
    expect(visits.data!.length).toBeGreaterThan(0);
    const stock = await acctA.client.from("stock_movements").select("id").eq("site_id", siteBId);
    expect(stock.data!.length).toBeGreaterThan(0);
  });

  it("a SITE manager (not New-Site) does NOT have cross-site read", async () => {
    // siteMgrB is at siteB (its own site); New-Site (siteA) data must be invisible.
    const visits = await siteMgrB.client.from("visits").select("id").eq("site_id", siteAId);
    expect(visits.data ?? []).toHaveLength(0);
    const adv = await siteMgrB.client.from("advances").select("id").eq("site_id", siteAId);
    expect(adv.data ?? []).toHaveLength(0);
  });

  it("processing + inventory remain site-scoped for reads", async () => {
    for (const u of [procA, invA]) {
      const { data } = await u.client.from("visits").select("id").eq("site_id", siteBId);
      expect(data ?? []).toHaveLength(0);
    }
    const { data: stock } = await invA.client.from("stock_movements").select("id").eq("site_id", siteBId);
    expect(stock ?? []).toHaveLength(0);
  });

  it("cross-site WRITE: general manager allowed; site manager + accountant denied", async () => {
    // The general manager (New-Site = siteA) CAN record an advance on site B.
    const { error: gmErr } = await mgrA.client.from("advances").insert({
      supplier_id: supplierId, site_id: siteBId, purpose: "gm cross-site", amount_naira: 1,
      recorded_by: mgrA.userId,
    });
    expect(gmErr).toBeNull();

    // A plain site manager cannot write on another site.
    const { error: siteErr } = await siteMgrB.client.from("advances").insert({
      supplier_id: supplierId, site_id: siteAId, purpose: "hack", amount_naira: 1,
      recorded_by: siteMgrB.userId,
    });
    expect(siteErr).not.toBeNull();

    // Accountant (cross-site read only) cannot record a payment on a site B visit.
    await adminClient().from("visits").update({ state: "pricing" }).eq("id", visitBId).then(() => {});
    const { error: payErr } = await acctA.client.from("payments").insert({
      visit_id: visitBId, direction: "processing_fee_in", amount: 1, recorded_by: acctA.userId,
    });
    expect(payErr).not.toBeNull();
  });
});
