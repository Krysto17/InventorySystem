import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// 0159: a visit moves only through the workflow that owns the transition, by a
// role that owns it. A direct state write is refused for every role except the
// gate release; the owner has no override.
describe("visits state machine — transitions", () => {
  let siteId: string;
  let proc: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "sm-proc", role: "processing", siteId });
    owner = await makeUser({ username: "sm-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "SM Supplier", phone: "07000000000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  // Visits start directly at the pipeline state — no gate stage. Intake is split
  // by path (#3): processing creates unprocessed, owner creates either path.
  async function newVisit(entryPath: "unprocessed" | "processed") {
    const initialState = entryPath === "unprocessed" ? "in_processing" : "in_receiving";
    const creator = entryPath === "unprocessed" ? proc : owner;
    const { data, error } = await creator.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: entryPath,
        state: initialState,
        created_by: creator.userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }
  const stateOf = async (id: string) =>
    (await adminClient().from("visits").select("state, closed_at").eq("id", id).single()).data!;

  it("in_processing → in_receiving happens when processing records its work", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await proc.client
      .from("processing_records")
      .insert({ visit_id: id, recorded_by: proc.userId });
    expect(error).toBeNull();
    expect((await stateOf(id)).state).toBe("in_receiving");
  });

  it("the same pair as a direct write is refused, even for the role that owns it", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await proc.client.from("visits").update({ state: "in_receiving" }).eq("id", id);
    expect(error?.code).toBe("VT001");
    expect((await stateOf(id)).state).toBe("in_processing");
  });

  it("in_processing → pricing is REJECTED (illegal jump)", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await proc.client.from("visits").update({ state: "pricing" }).eq("id", id);
    expect(error?.code).toBe("VT001");
    expect(error?.message).toBe("You cannot move this visit to that stage.");
  });

  it("in_receiving → pricing by direct write is REJECTED, owner included", async () => {
    const id = await newVisit("processed");
    const { error } = await owner.client.from("visits").update({ state: "pricing" }).eq("id", id);
    expect(error?.code).toBe("VT001");
  });

  it("the owner can no longer move state backward, and writes no owner_override", async () => {
    const id = await newVisit("unprocessed");
    await proc.client.from("processing_records").insert({ visit_id: id, recorded_by: proc.userId });
    const { error } = await owner.client.from("visits").update({ state: "in_processing" }).eq("id", id);
    expect(error?.code).toBe("VT001");
    expect((await stateOf(id)).state).toBe("in_receiving");
    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", id);
    expect(events!.map((e) => e.event_type)).not.toContain("owner_override");
  });

  it("entering exited (no-agreement) through the real workflow sets closed_at", async () => {
    const id = await newVisit("processed");
    // Analysis → pricing; no agreement → awaiting gate exit; authorised; released.
    expect((await owner.client
      .from("analysis_records")
      .insert({ visit_id: id, weight: 1, grade: "F", recorded_by: owner.userId })).error).toBeNull();
    expect((await stateOf(id)).state).toBe("pricing");
    expect((await owner.client.from("pricing")
      .insert({ visit_id: id, agreement_status: "not_agreed", priced_by: owner.userId })).error).toBeNull();
    expect((await stateOf(id)).state).toBe("awaiting_gate_exit");
    expect((await owner.client.from("gate_exit_authorizations")
      .insert({ visit_id: id, authorized_by: owner.userId })).error).toBeNull();
    const { error } = await owner.client.from("visits").update({ state: "exited" }).eq("id", id);
    expect(error).toBeNull();
    const v = await stateOf(id);
    expect(v.state).toBe("exited");
    expect(v.closed_at).not.toBeNull();
  });
});
