import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("no-agreement exit path", () => {
  let siteId: string;
  let proc: TestUser, recv: TestUser, mgr: TestUser, gate: TestUser;
  let supplierId: string, materialTypeId: string, machineId: string;

  // No-agreement now parks at awaiting_gate_exit: a manager/owner authorises the
  // exit, then the gate releases the supplier (→ exited).
  async function authoriseAndRelease(visitId: string) {
    await mgr.client.from("gate_exit_authorizations")
      .insert({ visit_id: visitId, authorized_by: mgr.userId });
    await gate.client.from("visits").update({ state: "exited" }).eq("id", visitId);
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "nae-proc", role: "processing", siteId });
    recv = await makeUser({ username: "nae-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "nae-mgr", role: "manager", siteId });
    gate = await makeUser({ username: "nae-gate", role: "gate", siteId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "NAE Supp", phone: "07011110001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: mc } = await adminClient()
      .from("machines")
      .insert({ site_id: siteId, name: "NAE Crusher", charge_basis: "weight", rate: 10 })
      .select("id")
      .single();
    machineId = mc!.id as string;
  });

  it("unprocessed: manager rejects → visit exits directly — processing fee still owed", async () => {
    const { data: v } = await proc.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "in_processing",
        created_by: proc.userId,
      })
      .select("id")
      .single();

    const { data: pr } = await proc.client
      .from("processing_records")
      .insert({ visit_id: v!.id, recorded_by: proc.userId })
      .select("id")
      .single();
    await proc.client.from("processing_machine_usage").insert({
      processing_record_id: pr!.id,
      machine_id: machineId,
      measurement: 100,
      rate_snapshot: 10,
    });

    await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 0.1, grade: "F", recorded_by: recv.userId });

    // Manager records "no agreement" — visit parks at awaiting_gate_exit.
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      agreement_status: "not_agreed",
      priced_by: mgr.userId,
    });

    const { data: parked } = await adminClient()
      .from("visits").select("state").eq("id", v!.id).single();
    expect(parked?.state).toBe("awaiting_gate_exit");

    // Manager authorises, gate releases → exited.
    await authoriseAndRelease(v!.id);
    const { data: final } = await adminClient()
      .from("visits")
      .select("state, closed_at")
      .eq("id", v!.id)
      .single();
    expect(final?.state).toBe("exited");
    expect(final?.closed_at).not.toBeNull();

    // Processing fee is still owed even though no purchase happened.
    const { data: usage } = await adminClient()
      .from("processing_machine_usage")
      .select("line_cost")
      .eq("processing_record_id", pr!.id);
    expect(Number(usage![0].line_cost)).toBe(100 * 10);
  });

  it("processed: nothing owed when exiting without agreement", async () => {
    const { data: v } = await recv.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_receiving",
        created_by: recv.userId,
      })
      .select("id")
      .single();
    await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 0.5, grade: "F", recorded_by: recv.userId });
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      agreement_status: "not_agreed",
      priced_by: mgr.userId,
    });
    await authoriseAndRelease(v!.id);

    const { data: final } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(final?.state).toBe("exited");

    const { data: pr } = await adminClient()
      .from("processing_records")
      .select("id")
      .eq("visit_id", v!.id);
    expect(pr?.length).toBe(0);
  });
});
