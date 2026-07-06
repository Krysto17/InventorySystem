import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// The New-Site (general) manager runs the receiving module: create a processed
// visit, record + delete lines, and submit the batch to analysis/pricing. A
// plain site manager may not.
describe("general manager receiving module", () => {
  let newSiteId: string, otherSiteId: string;
  let gm: TestUser, siteMgr: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    newSiteId = sites!.find((s) => s.name === "New-Site")!.id as string;
    otherSiteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    gm = await makeUser({ username: "gmr-gm", role: "manager", siteId: newSiteId }); // general
    siteMgr = await makeUser({ username: "gmr-sm", role: "manager", siteId: otherSiteId }); // site
    const { data: s } = await adminClient().from("suppliers").insert({ name: `GMR ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  it("GM creates a processed visit, records a line, and submits it", async () => {
    // Create a receiving (processed → in_receiving) visit.
    const { data: v, error: vErr } = await gm.client.from("visits").insert({
      site_id: newSiteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: gm.userId,
    }).select("id").single();
    expect(vErr).toBeNull();
    const visitId = v!.id as string;

    // Record a material line (no analysis required so it goes straight to pricing).
    const { data: line, error: lErr } = await gm.client.from("visit_materials").insert({
      visit_id: visitId, material_type_id: monaziteId, weight_kg: 80,
      magnetic_analysis: "Monazite 3%", requires_analysis: false, recorded_by: gm.userId,
    }).select("id").single();
    expect(lErr).toBeNull();

    // A second, deletable draft line.
    const { data: draft } = await gm.client.from("visit_materials").insert({
      visit_id: visitId, material_type_id: monaziteId, weight_kg: 5, requires_analysis: false, recorded_by: gm.userId,
    }).select("id").single();
    const { error: dErr } = await gm.client.from("visit_materials").delete().eq("id", draft!.id);
    expect(dErr).toBeNull();

    // Submit the batch → exempt lines send it to pricing.
    const { error: sErr } = await gm.client.rpc("submit_visit_to_manager", { p_visit_id: visitId });
    expect(sErr).toBeNull();
    const { data: after } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(after!.state).toBe("pricing");
    expect(line).toBeTruthy();
  });

  it("a site manager cannot create a visit", async () => {
    const { error } = await siteMgr.client.from("visits").insert({
      site_id: otherSiteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: siteMgr.userId,
    });
    expect(error).not.toBeNull(); // site managers don't do intake
  });
});
