import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// Manager sends the processing fee back; the processing employee corrects the
// machine usage and the light-bill fee recomputes in place (no state change).
describe("reopen processing fee", () => {
  let siteId: string, monazite: string, machineId: string, supplierId: string;
  let mgr: TestUser, proc: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name !== "New-Site")!.id as string;
    mgr = await makeUser({ username: "rpf-mgr", role: "manager", siteId });
    proc = await makeUser({ username: "rpf-proc", role: "processing", siteId });
    const { data: s } = await adminClient().from("suppliers").insert({ name: `RPF ${Date.now()}` }).select("id").single();
    supplierId = s!.id as string;
    const { data: mz } = await adminClient().from("material_types").select("id").eq("name", "Monazite").single();
    monazite = mz!.id as string;
    const { data: m } = await adminClient().from("machines").insert({ site_id: siteId, name: `RPF Crusher ${Date.now()}`, charge_basis: "weight", rate: 10 }).select("id").single();
    machineId = m!.id as string;
  });

  it("manager reopens → processing corrects usage → fee recomputes, flag cleared", async () => {
    // Visit at pricing with a processing record + usage (100 * 10 = 1000 fee).
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "unprocessed", state: "pricing", created_by: proc.userId,
    }).select("id").single();
    const visitId = v!.id as string;
    const { data: rec } = await adminClient().from("processing_records").insert({
      visit_id: visitId, recorded_by: proc.userId, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), discount_percent: 0,
    }).select("id").single();
    await adminClient().from("processing_machine_usage").insert({ processing_record_id: rec!.id, machine_id: machineId, measurement: 100, rate_snapshot: 10 });
    await adminClient().from("utility_charges").insert({ visit_id: visitId, kind: "light_bill", description: "Processing fee", amount: 1000, recorded_by: proc.userId });

    // Manager reopens.
    const { error: rErr } = await mgr.client.rpc("reopen_processing_fee", { p_visit_id: visitId });
    expect(rErr).toBeNull();
    let { data: pr } = await adminClient().from("processing_records").select("fee_reopened").eq("id", rec!.id).single();
    expect(pr!.fee_reopened).toBe(true);

    // Processing corrects usage to 60 (fee should become 600), then syncs.
    await proc.client.from("processing_machine_usage").delete().eq("processing_record_id", rec!.id);
    const { error: insErr } = await proc.client.from("processing_machine_usage").insert({ processing_record_id: rec!.id, machine_id: machineId, measurement: 60, rate_snapshot: 10 });
    expect(insErr).toBeNull();
    const { error: sErr } = await proc.client.rpc("sync_processing_fee", { p_visit_id: visitId });
    expect(sErr).toBeNull();

    const { data: fee } = await adminClient().from("utility_charges").select("amount").eq("visit_id", visitId).eq("kind", "light_bill").single();
    expect(Number(fee!.amount)).toBe(600);
    ({ data: pr } = await adminClient().from("processing_records").select("fee_reopened").eq("id", rec!.id).single());
    expect(pr!.fee_reopened).toBe(false);

    // Visit state unchanged.
    const { data: vv } = await adminClient().from("visits").select("state").eq("id", visitId).single();
    expect(vv!.state).toBe("pricing");
  });

  it("a non-manager cannot reopen", async () => {
    const { data: v } = await adminClient().from("visits").insert({
      site_id: siteId, supplier_id: supplierId, declared_material_type_id: monazite,
      entry_path: "unprocessed", state: "pricing", created_by: proc.userId,
    }).select("id").single();
    await adminClient().from("processing_records").insert({ visit_id: v!.id, recorded_by: proc.userId, discount_percent: 0 });
    const { error } = await proc.client.rpc("reopen_processing_fee", { p_visit_id: v!.id });
    expect(error).not.toBeNull();
  });
});
