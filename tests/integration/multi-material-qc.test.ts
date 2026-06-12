import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// End-to-end: one supplier brings TWO materials in one batch → receiving weighs
// each line → QC records an XRF per line → submitting all lines advances to
// pricing → manager prices each line → purchase_amount is the sum.
describe("multi-material batch → QC → pricing (integration)", () => {
  let siteId: string;
  let proc: TestUser, recv: TestUser, qc: TestUser, mgr: TestUser;
  let supplierId: string, matA: string, matB: string;

  beforeAll(async () => {
    const { data: site } = await adminClient().from("sites").select("id").limit(1).single();
    siteId = site!.id as string;
    proc = await makeUser({ username: "mm-proc", role: "processing", siteId });
    recv = await makeUser({ username: "mm-recv", role: "receiving",  siteId });
    qc   = await makeUser({ username: "mm-qc",   role: "qc",         siteId });
    mgr  = await makeUser({ username: "mm-mgr",  role: "manager",    siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: "Batch Supplier" }).select("id").single();
    supplierId = s!.id as string;
    // Monazite + Zircon — the real multi-material pairing; magnetic analysis
    // is only legal on the Monazite line (Phase 10 rule).
    const { data: mz } = await adminClient()
      .from("material_types").select("id").eq("name", "Monazite").single();
    const { data: zr } = await adminClient()
      .from("material_types").select("id").eq("name", "Zircon").single();
    matA = mz!.id as string;
    matB = zr!.id as string;
  });

  it("runs the full multi-material pipeline", async () => {
    // 1. processing creates a pre_processed visit straight into receiving
    const { data: v, error: ve } = await proc.client.from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: matA,
      entry_path: "pre_processed", state: "in_receiving", created_by: proc.userId,
    }).select("id").single();
    expect(ve).toBeNull();
    const visitId = v!.id as string;

    // 2. receiving records TWO material lines (monazite + zircon, one batch)
    const { data: lineA } = await recv.client.from("visit_materials").insert({
      visit_id: visitId, material_type_id: matA, weight_kg: 120,
      magnetic_analysis: "high", recorded_by: recv.userId,
    }).select("id").single();
    const { data: lineB } = await recv.client.from("visit_materials").insert({
      visit_id: visitId, material_type_id: matB, weight_kg: 80,
      recorded_by: recv.userId,
    }).select("id").single();
    expect(lineA?.id).toBeTruthy();
    expect(lineB?.id).toBeTruthy();

    // 3. receiving advances the visit to QC
    const { error: advErr } = await recv.client.rpc("advance_visit_to_qc", { p_visit_id: visitId });
    expect(advErr).toBeNull();
    let { data: st } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(st!.state).toBe("in_qc");

    // 4. QC records an XRF result per line (submitted)
    await qc.client.from("xrf_records").insert({ visit_material_id: lineA!.id, result: "Sn 60%", submitted: true, recorded_by: qc.userId });
    // Not yet all submitted → still in_qc
    ({ data: st } = await adminClient().from("visits").select("state").eq("id", visitId).single());
    expect(st!.state).toBe("in_qc");
    await qc.client.from("xrf_records").insert({ visit_material_id: lineB!.id, result: "Zr 45%", submitted: true, recorded_by: qc.userId });

    // 5. all lines submitted → auto-advanced to pricing
    ({ data: st } = await adminClient().from("visits").select("state").eq("id", visitId).single());
    expect(st!.state).toBe("pricing");

    // 6. manager prices each line (optional per-line price)
    await mgr.client.from("visit_materials").update({ unit_price: 100, priced_by: mgr.userId }).eq("id", lineA!.id);
    await mgr.client.from("visit_materials").update({ unit_price: 200, priced_by: mgr.userId }).eq("id", lineB!.id);

    // 7. per-visit pricing row reflects the SUM of line purchase_amounts
    const { error: pErr } = await mgr.client.from("pricing").insert({
      visit_id: visitId, agreement_status: "agreed", payment_terms: "immediate", priced_by: mgr.userId,
    });
    expect(pErr).toBeNull();
    const { data: pricing } = await adminClient().from("pricing").select("purchase_amount").eq("visit_id", visitId).single();
    // 120*100 + 80*200 = 12000 + 16000 = 28000
    expect(Number(pricing!.purchase_amount)).toBe(28000);

    // 8. agreement moved the visit to accounting
    ({ data: st } = await adminClient().from("visits").select("state").eq("id", visitId).single());
    expect(st!.state).toBe("in_accounting");
  });
});
