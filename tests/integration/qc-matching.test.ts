import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Phase 10 (F): magnetic-only-for-Monazite, QC weight mismatch auto-flag,
// per-line analysis exemption, supplier identity codes.
describe("QC matching + analysis rules (integration)", () => {
  let siteId: string;
  let recv: TestUser, qc: TestUser, mgr: TestUser;
  let supplierId: string, monaziteId: string, zirconId: string;

  // Flow now: receiving submits straight to analysis (in_qc), or to pricing when
  // no line needs analysis — no manager-approval step (#3).
  async function advance(visitId: string) {
    return recv.client.rpc("submit_visit_to_manager", { p_visit_id: visitId });
  }

  async function newVisit(state = "in_receiving") {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monaziteId,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    if (state !== "in_receiving") await adminClient().from("visits").update({ state }).eq("id", v!.id);
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    recv = await makeUser({ username: "qcm-recv", role: "receiving", siteId });
    qc   = await makeUser({ username: "qcm-qc",   role: "qc",        siteId });
    mgr  = await makeUser({ username: "qcm-mgr",  role: "manager",   siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "QCM Supplier" }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    const { data: zr } = await adminClient().from("material_types").select("id").eq("name", "Zircon").single();
    monaziteId = mz!.id as string;
    zirconId = zr!.id as string;
  });

  it("magnetic analysis is accepted on Monazite, rejected on Zircon", async () => {
    const v = await newVisit();
    const ok = await recv.client.from("visit_materials").insert({
      visit_id: v, material_type_id: monaziteId, weight_kg: 50,
      magnetic_analysis: "70% magnetic", recorded_by: recv.userId,
    });
    expect(ok.error).toBeNull();
    const bad = await recv.client.from("visit_materials").insert({
      visit_id: v, material_type_id: zirconId, weight_kg: 50,
      magnetic_analysis: "should fail", recorded_by: recv.userId,
    });
    expect(bad.error).not.toBeNull();
    expect(bad.error!.message).toMatch(/Monazite/i);
  });

  it("QC weight within 2% does not flag; beyond 2% flags a mismatch", async () => {
    const v = await newVisit();
    const { data: line } = await adminClient().from("visit_materials").insert({
      visit_id: v, material_type_id: monaziteId, weight_kg: 100, recorded_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visits").update({ state: "in_qc" }).eq("id", v);

    // 101 kg vs 100 kg = 1% → no flag
    await qc.client.from("xrf_records").insert({
      visit_material_id: line!.id, result: "ok", weight_kg: 101, recorded_by: qc.userId,
    });
    let { data: x } = await adminClient().from("xrf_records").select("mismatch").eq("visit_material_id", line!.id).single();
    expect(x!.mismatch).toBe(false);

    // 90 kg vs 100 kg = 10% → flagged
    await qc.client.from("xrf_records").update({ weight_kg: 90 }).eq("visit_material_id", line!.id);
    ({ data: x } = await adminClient().from("xrf_records").select("mismatch").eq("visit_material_id", line!.id).single());
    expect(x!.mismatch).toBe(true);
  });

  it("a batch where NO line requires analysis skips QC straight to pricing", async () => {
    const v = await newVisit();
    await recv.client.from("visit_materials").insert({
      visit_id: v, material_type_id: zirconId, weight_kg: 40,
      requires_analysis: false, recorded_by: recv.userId,
    });
    const { error } = await advance(v);
    expect(error).toBeNull();
    const { data: st } = await adminClient().from("visits").select("state").eq("id", v).single();
    expect(st!.state).toBe("pricing");
  });

  it("manager may BYPASS analysis from in_qc → pricing (price without XRF, #3)", async () => {
    const v = await newVisit();
    // A line that requires analysis → submit routes to in_qc.
    await recv.client.from("visit_materials").insert({
      visit_id: v, material_type_id: monaziteId, weight_kg: 70, recorded_by: recv.userId,
    });
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v });
    let { data: st } = await adminClient().from("visits").select("state").eq("id", v).single();
    expect(st!.state).toBe("in_qc");
    // Manager skips analysis → straight to pricing.
    const { error } = await mgr.client.rpc("manager_skip_to_pricing", { p_visit_id: v });
    expect(error).toBeNull();
    ({ data: st } = await adminClient().from("visits").select("state").eq("id", v).single());
    expect(st!.state).toBe("pricing");
  });

  it("a mixed batch advances once only the REQUIRED lines have submitted XRF", async () => {
    const v = await newVisit();
    const { data: req } = await adminClient().from("visit_materials").insert({
      visit_id: v, material_type_id: monaziteId, weight_kg: 60, recorded_by: recv.userId,
    }).select("id").single();
    await adminClient().from("visit_materials").insert({
      visit_id: v, material_type_id: zirconId, weight_kg: 30,
      requires_analysis: false, recorded_by: recv.userId,
    });
    await advance(v);
    let { data: st } = await adminClient().from("visits").select("state").eq("id", v).single();
    expect(st!.state).toBe("in_qc");

    // Submitting the single required line advances the visit (exempt line ignored)
    await qc.client.from("xrf_records").insert({
      visit_material_id: req!.id, result: "Sn 55%", submitted: true, recorded_by: qc.userId,
    });
    ({ data: st } = await adminClient().from("visits").select("state").eq("id", v).single());
    expect(st!.state).toBe("pricing");
  });

  it("admin-created suppliers fall back to the SUP-MJZ prefix; renames keep history", async () => {
    const { data: s } = await adminClient().from("suppliers")
      .insert({ name: "Musa Ahmed" }).select("id, supplier_code").single();
    expect(s!.supplier_code).toMatch(/^SUP-MJZ-\d{4}$/);

    await adminClient().from("suppliers").update({ name: "Ahmed Musa" }).eq("id", s!.id);
    const { data: renamed } = await adminClient().from("suppliers")
      .select("name, former_names").eq("id", s!.id).single();
    expect(renamed!.name).toBe("Ahmed Musa");
    expect(renamed!.former_names).toContain("Musa Ahmed");
  });

  it("a supplier created by a site user gets a site-prefixed code", async () => {
    // current_site() drives the prefix from the creating user's site name.
    const { data: site } = await adminClient().from("sites").select("name").eq("id", siteId).single();
    const prefix = site!.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
    const { data, error } = await recv.client.from("suppliers")
      .insert({ name: `Site Supplier ${Date.now()}` })
      .select("supplier_code")
      .single();
    expect(error).toBeNull();
    expect(data!.supplier_code).toBe(`SUP-${prefix}-${data!.supplier_code.slice(-4)}`);
    expect(data!.supplier_code).toMatch(/^SUP-[A-Z]{3}-\d{4}$/);
  });
});
