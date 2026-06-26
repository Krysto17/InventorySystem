import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// #9: a QC analyst can read back every XRF analysis they've recorded, joined to
// material + supplier (the query the "My analyses" sheet runs), and only theirs.
describe("QC analyses sheet (#9)", () => {
  let siteId: string;
  let recv: TestUser, qc: TestUser, qc2: TestUser, mgr: TestUser;
  let supplierId: string, monaziteId: string;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    recv = await makeUser({ username: "qas-recv", role: "receiving", siteId });
    qc   = await makeUser({ username: "qas-qc",   role: "qc",        siteId });
    qc2  = await makeUser({ username: "qas-qc2",  role: "qc",        siteId });
    mgr  = await makeUser({ username: "qas-mgr",  role: "manager",   siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "QAS Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monaziteId = mz!.id as string;
  });

  it("returns the analyst's own analyses with material + supplier, scoped per analyst", async () => {
    const { data: v } = await recv.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: line } = await recv.client.from("visit_materials").insert({
      visit_id: v!.id, material_type_id: monaziteId, weight_kg: 100, recorded_by: recv.userId,
    }).select("id").single();
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v!.id });
    await mgr.client.rpc("approve_visit_by_manager", { p_visit_id: v!.id });

    await qc.client.from("xrf_records").insert({
      visit_material_id: line!.id, result: "Sn 60%", weight_kg: 99, recorded_by: qc.userId,
    });

    const sheet = await qc.client
      .from("xrf_records")
      .select(`
        id, result, weight_kg, mismatch, submitted,
        visit_material:visit_materials!inner(
          material_type:material_types(name),
          visit:visits(id, supplier:suppliers(name))
        )
      `)
      .eq("recorded_by", qc.userId);

    expect(sheet.error).toBeNull();
    expect(sheet.data!.length).toBe(1);
    const row = sheet.data![0] as Record<string, unknown>;
    const vm = row.visit_material as { material_type: { name: string }; visit: { supplier: { name: string } } };
    expect(vm.material_type.name).toBe("Monazite");
    expect(vm.visit.supplier.name).toBe("QAS Supplier");

    // The sheet filters by recorded_by, so a second analyst's own sheet is
    // empty (they've recorded nothing) — that's the per-analyst guarantee #9 needs.
    const other = await qc2.client.from("xrf_records").select("id").eq("recorded_by", qc2.userId);
    expect(other.data ?? []).toHaveLength(0);
  });

  // #14 "done" list: QC's completed list is driven by their xrf_records, so an
  // exempt batch that skipped QC must NOT appear among their analysed visits.
  it("QC done list excludes an exempt batch that skipped QC", async () => {
    // Analysed batch: one required line, QC submits an XRF → advances to pricing.
    const { data: vA } = await recv.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    const { data: lineA } = await recv.client.from("visit_materials").insert({
      visit_id: vA!.id, material_type_id: monaziteId, weight_kg: 50, recorded_by: recv.userId,
    }).select("id").single();
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: vA!.id });
    await mgr.client.rpc("approve_visit_by_manager", { p_visit_id: vA!.id });
    await qc.client.from("xrf_records").insert({
      visit_material_id: lineA!.id, result: "Sn 55%", submitted: true, recorded_by: qc.userId,
    });

    // Exempt batch: a single requires_analysis=false line → skips QC to pricing.
    const { data: vB } = await recv.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    await recv.client.from("visit_materials").insert({
      visit_id: vB!.id, material_type_id: monaziteId, weight_kg: 40,
      requires_analysis: false, recorded_by: recv.userId,
    });
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: vB!.id });
    await mgr.client.rpc("approve_visit_by_manager", { p_visit_id: vB!.id });

    // Replicate listQcCompletedVisits: analyst's xrf → distinct visit ids → not in_qc.
    const { data: xrf } = await qc.client
      .from("xrf_records")
      .select("visit_material:visit_materials!inner(visit_id)")
      .eq("recorded_by", qc.userId);
    const ids = Array.from(new Set((xrf ?? []).map((r) => {
      const vm = (r as { visit_material: unknown }).visit_material;
      return (Array.isArray(vm) ? vm[0] : vm) as { visit_id: string };
    }).map((v) => v.visit_id)));
    const { data: doneVisits } = await qc.client
      .from("visits").select("id").in("id", ids).neq("state", "in_qc");

    const doneIds = (doneVisits ?? []).map((v) => v.id);
    expect(doneIds).toContain(vA!.id); // analysed
    expect(doneIds).not.toContain(vB!.id); // exempt, skipped QC
  });
});
