import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Material that needs no chemical analysis used to skip QC entirely, which also
// skipped QC's re-weigh — the check that catches a weight difference. It now
// goes to QC like everything else and is confirmed on the weight alone.
describe("exempt material still passes through QC", () => {
  let siteId: string, supplierId: string, material: string;
  let recv: TestUser, qc: TestUser, owner: TestUser;

  const newVisit = async () => {
    const { data } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: material,
      entry_path: "processed", state: "in_receiving", created_by: recv.userId,
    }).select("id").single();
    return data!.id as string;
  };
  const addLine = async (visitId: string, requiresAnalysis: boolean, weight = 100) => {
    const { data } = await adminClient().from("visit_materials").insert({
      visit_id: visitId, material_type_id: material, weight_kg: weight,
      requires_analysis: requiresAnalysis,
    }).select("id").single();
    return data!.id as string;
  };
  const stateOf = async (visitId: string) =>
    (await adminClient().from("visits").select("state").eq("id", visitId).single()).data!.state;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    recv = await makeUser({ username: "eq-recv", role: "receiving", siteId });
    qc = await makeUser({ username: "eq-qc", role: "qc", siteId });
    owner = await makeUser({ username: "eq-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `EQ ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mt } = await adminClient().from("material_types")
      .insert({ name: `Exempt-Ore ${Date.now()}` }).select("id").single();
    material = mt!.id as string;
  });

  it("sends a batch of exempt lines to QC, not straight to pricing", async () => {
    const v = await newVisit();
    await addLine(v, false);
    expect((await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v })).error).toBeNull();
    expect(await stateOf(v)).toBe("in_qc");
  });

  it("QC confirms an exempt line on its weight, with no XRF result", async () => {
    const v = await newVisit();
    const line = await addLine(v, false, 80);
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v });

    const { error } = await qc.client.from("xrf_records").insert({
      visit_material_id: line, result: null, weight_kg: 80, submitted: true, recorded_by: qc.userId,
    });
    expect(error).toBeNull();
    expect(await stateOf(v)).toBe("pricing");
  });

  it("still catches a weight difference on exempt material", async () => {
    const v = await newVisit();
    const line = await addLine(v, false, 100);
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v });
    // QC weighs it 10% light — the whole point of routing it through QC.
    await qc.client.from("xrf_records").insert({
      visit_material_id: line, result: null, weight_kg: 90, submitted: true, recorded_by: qc.userId,
    });
    const { data } = await adminClient().from("xrf_records").select("mismatch").eq("visit_material_id", line).single();
    expect(data!.mismatch).toBe(true);
  });

  it("waits for every line, mixed exempt and analysed", async () => {
    const v = await newVisit();
    const exempt = await addLine(v, false, 40);
    const analysed = await addLine(v, true, 60);
    await recv.client.rpc("submit_visit_to_manager", { p_visit_id: v });

    await qc.client.from("xrf_records").insert({
      visit_material_id: exempt, result: null, weight_kg: 40, submitted: true, recorded_by: qc.userId,
    });
    expect(await stateOf(v)).toBe("in_qc"); // the analysed line is still open

    await qc.client.from("xrf_records").insert({
      visit_material_id: analysed, result: "Sn 62%", weight_kg: 60, submitted: true, recorded_by: qc.userId,
    });
    expect(await stateOf(v)).toBe("pricing");
  });

  it("the manager's explicit waiver still goes straight to pricing", async () => {
    const v = await newVisit();
    await addLine(v, true);
    await adminClient().from("visits").update({ state: "awaiting_manager" }).eq("id", v);
    expect((await owner.client.rpc("approve_visit_by_manager", { p_visit_id: v, p_skip_qc: true })).error).toBeNull();
    expect(await stateOf(v)).toBe("pricing");
  });
});
