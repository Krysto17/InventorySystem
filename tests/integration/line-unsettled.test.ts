import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Per-line "unsettled": a manager (own site) or owner removes a line, or gate-
// passes it out (excluded from the batch purchase total), reversibly.
describe("unsettle / re-settle / remove a material line (integration)", () => {
  let siteId: string, otherSiteId: string;
  let recv: TestUser, mgr: TestUser, mgr2: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    // Two NON-New-Site sites so mgr2 is a plain site manager (denied cross-site);
    // the general (New-Site) manager can write cross-site.
    const { data: sites } = await adminClient().from("sites").select("id, name").order("name");
    const siteMgrSites = sites!.filter((s) => s.name !== "New-Site");
    siteId = siteMgrSites[0].id as string;
    otherSiteId = siteMgrSites[1].id as string;
    recv = await makeUser({ username: "uns-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "uns-mgr", role: "manager", siteId });
    mgr2 = await makeUser({ username: "uns-mgr2", role: "manager", siteId: otherSiteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Unsettle Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  async function newPricedVisit() {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "pricing", created_by: recv.userId,
    }).select("id").single();
    const { data: a } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, unit_price: 10, recorded_by: recv.userId,
    }).select("id").single(); // 1000
    const { data: b } = await adminClient().from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 50, unit_price: 20, recorded_by: recv.userId,
    }).select("id").single(); // 1000
    await adminClient().from("pricing").insert({ visit_id: v!.id, priced_by: mgr.userId, agreement_status: "pending" });
    return { visitId: v!.id as string, lineA: a!.id as string, lineB: b!.id as string };
  }
  const total = async (visitId: string) =>
    Number((await adminClient().from("pricing").select("purchase_amount").eq("visit_id", visitId).single()).data!.purchase_amount);

  it("unsettling a line excludes it from the total and issues a gate pass; re-settling reverses it", async () => {
    const { visitId, lineA } = await newPricedVisit();
    expect(await total(visitId)).toBe(2000);

    const { error } = await mgr.client.rpc("unsettle_line", { p_line_id: lineA, p_reason: "low grade" });
    expect(error).toBeNull();

    const { data: line } = await adminClient().from("visit_materials").select("settlement_status, unsettled_reason").eq("id", lineA).single();
    expect(line!.settlement_status).toBe("unsettled");
    expect(line!.unsettled_reason).toBe("low grade");
    const { data: gp } = await adminClient().from("gate_passes").select("status, weight_kg").eq("visit_material_id", lineA).single();
    expect(gp!.status).toBe("issued");
    expect(Number(gp!.weight_kg)).toBe(100);
    expect(await total(visitId)).toBe(1000); // lineA excluded

    await mgr.client.rpc("resettle_line", { p_line_id: lineA });
    const { data: back } = await adminClient().from("visit_materials").select("settlement_status").eq("id", lineA).single();
    expect(back!.settlement_status).toBe("settled");
    const { data: gp2 } = await adminClient().from("gate_passes").select("status").eq("visit_material_id", lineA).single();
    expect(gp2!.status).toBe("cancelled");
    expect(await total(visitId)).toBe(2000);
  });

  it("removing a line deletes it and recomputes the total", async () => {
    const { visitId, lineB } = await newPricedVisit();
    const { error } = await mgr.client.rpc("remove_line", { p_line_id: lineB });
    expect(error).toBeNull();
    const { data: gone } = await adminClient().from("visit_materials").select("id").eq("id", lineB);
    expect(gone ?? []).toHaveLength(0);
    expect(await total(visitId)).toBe(1000);
  });

  it("a different-site manager cannot unsettle the line", async () => {
    const { lineA } = await newPricedVisit();
    const { error } = await mgr2.client.rpc("unsettle_line", { p_line_id: lineA });
    expect(error).not.toBeNull();
  });
});
