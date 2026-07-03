import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The general manager (New-Site) creates/edits/deletes records at any site;
// a site manager stays scoped to their own site.
describe("general manager cross-site write", () => {
  let newSiteId: string, otherSiteId: string;
  let gm: TestUser, siteMgr: TestUser, recv: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSiteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    otherSiteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    gm = await makeUser({ username: "gmw-gm", role: "manager", siteId: newSiteId }); // general manager
    siteMgr = await makeUser({ username: "gmw-sm", role: "manager", siteId: otherSiteId }); // site manager
    recv = await makeUser({ username: "gmw-recv", role: "receiving", siteId: otherSiteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `GMW ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  async function pricingVisitAtOtherSite() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: otherSiteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, unit_price: 50, requires_analysis: false, recorded_by: recv.userId,
    }).select("id").single();
    return { visitId: v!.id as string, lineId: line!.id as string };
  }

  it("GM edits and prices a line at another site", async () => {
    const { visitId, lineId } = await pricingVisitAtOtherSite();

    // Edit a line cross-site.
    await gm.client.from("visit_materials").update({ weight_kg: 110 }).eq("id", lineId);
    const { data: l } = await adminClient().from("visit_materials").select("weight_kg").eq("id", lineId).single();
    expect(Number(l!.weight_kg)).toBe(110);

    // Submit an agreed pricing cross-site → awaiting_price_approval.
    const { error: pErr } = await gm.client.from("pricing").insert({
      visit_id: visitId, agreement_status: "agreed", payment_terms: "immediate", priced_by: gm.userId,
    });
    expect(pErr).toBeNull();
    const { data: v } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(v!.state).toBe("awaiting_price_approval");
  });

  it("GM unsettles a line at another site", async () => {
    // A fresh visit (no agreed pricing) so unsettling the line is clean.
    const { lineId } = await pricingVisitAtOtherSite();
    const { error: uErr } = await gm.client.rpc("unsettle_line", { p_line_id: lineId });
    expect(uErr).toBeNull();
    const { data: l } = await adminClient().from("visit_materials").select("settlement_status").eq("id", lineId).single();
    expect(l!.settlement_status).toBe("unsettled");
  });

  it("a site manager cannot edit another site's line", async () => {
    // gmw-sm is at otherSite; make a visit at New-Site to prove the boundary.
    const { data: v } = await adminClient().from("visits").insert({
      site_id: newSiteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, requires_analysis: false, recorded_by: recv.userId,
    }).select("id").single();
    await siteMgr.client.from("visit_materials").update({ weight_kg: 999 }).eq("id", line!.id);
    const { data: l } = await adminClient().from("visit_materials").select("weight_kg").eq("id", line!.id).single();
    expect(Number(l!.weight_kg)).toBe(100); // unchanged — site manager can't cross sites
  });
});
