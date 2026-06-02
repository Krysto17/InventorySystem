import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("no-agreement exit path", () => {
  let siteId: string;
  let gate: TestUser, recv: TestUser, mgr: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string, machineId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    gate = await makeUser({ username: "nae-gate", role: "gate", siteId });
    recv = await makeUser({ username: "nae-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "nae-mgr", role: "manager", siteId });
    owner = await makeUser({ username: "nae-owner", role: "owner", siteId: null });
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

  it("unprocessed: manager rejects, owner authorizes, gate releases — processing fee still owed", async () => {
    const { data: v } = await gate.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "at_gate_in",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    await gate.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);

    const proc = await makeUser({ username: "nae-proc", role: "processing", siteId });
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

    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      agreement_status: "not_agreed",
      priced_by: mgr.userId,
    });
    const { data: s1 } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(s1?.state).toBe("awaiting_gate_exit");

    await owner.client.from("gate_exit_authorizations").insert({
      visit_id: v!.id,
      authorized_by: owner.userId,
      note: "client takes material back",
    });

    await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);
    const { data: final } = await adminClient()
      .from("visits")
      .select("state, closed_at")
      .eq("id", v!.id)
      .single();
    expect(final?.state).toBe("exited");
    expect(final?.closed_at).not.toBeNull();

    const { data: usage } = await adminClient()
      .from("processing_machine_usage")
      .select("line_cost")
      .eq("processing_record_id", pr!.id);
    expect(Number(usage![0].line_cost)).toBe(100 * 10);
  });

  it("pre_processed: nothing owed when exiting without agreement", async () => {
    const { data: v } = await gate.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "at_gate_in",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 0.5, grade: "F", recorded_by: recv.userId });
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      agreement_status: "not_agreed",
      priced_by: mgr.userId,
    });
    await owner.client.from("gate_exit_authorizations").insert({
      visit_id: v!.id,
      authorized_by: owner.userId,
    });
    await gate.client.from("visits").update({ state: "exited" }).eq("id", v!.id);

    const { data: pr } = await adminClient()
      .from("processing_records")
      .select("id")
      .eq("visit_id", v!.id);
    expect(pr?.length).toBe(0);
  });
});
