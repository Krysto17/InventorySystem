import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("visits state machine — transitions", () => {
  let siteId: string;
  let gate: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    gate = await makeUser({ username: "sm-gate", role: "gate", siteId });
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

  async function newVisit(entryPath: "unprocessed" | "pre_processed") {
    const { data, error } = await gate.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: entryPath,
        state: "at_gate_in",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  it("at_gate_in → in_processing is allowed", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await gate.client
      .from("visits")
      .update({ state: "in_processing" })
      .eq("id", id);
    expect(error).toBeNull();
  });

  it("at_gate_in → pricing is REJECTED (illegal jump)", async () => {
    const id = await newVisit("unprocessed");
    const { error } = await gate.client
      .from("visits")
      .update({ state: "pricing" })
      .eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/illegal state transition/);
  });

  it("in_receiving → pricing is REJECTED without analysis_records row", async () => {
    const id = await newVisit("pre_processed");
    await owner.client.from("visits").update({ state: "in_receiving" }).eq("id", id);
    const { error } = await owner.client
      .from("visits")
      .update({ state: "pricing" })
      .eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/analysis_records/);
  });

  it("owner can move state backward (logs owner_override event)", async () => {
    const id = await newVisit("unprocessed");
    await owner.client.from("visits").update({ state: "in_processing" }).eq("id", id);
    const { error } = await owner.client
      .from("visits")
      .update({ state: "at_gate_in" })
      .eq("id", id);
    expect(error).toBeNull();
    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", id)
      .order("created_at", { ascending: true });
    expect(events!.map((e) => e.event_type)).toContain("owner_override");
  });

  it("entering exited sets closed_at (requires authorization)", async () => {
    const id = await newVisit("pre_processed");
    await owner.client.from("visits").update({ state: "in_receiving" }).eq("id", id);
    await owner.client.from("visits").update({ state: "awaiting_gate_exit" }).eq("id", id);
    await owner.client
      .from("gate_exit_authorizations")
      .insert({ visit_id: id, authorized_by: owner.userId });
    const { error } = await owner.client
      .from("visits")
      .update({ state: "exited" })
      .eq("id", id);
    expect(error).toBeNull();
    const { data: v } = await adminClient()
      .from("visits")
      .select("closed_at")
      .eq("id", id)
      .single();
    expect(v?.closed_at).not.toBeNull();
  });
});
