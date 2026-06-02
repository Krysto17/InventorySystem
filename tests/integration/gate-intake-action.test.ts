import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, firstSiteId, type TestUser } from "../setup/supabase-test-clients";

describe("gate intake — direct DB equivalent", () => {
  let gate: TestUser, siteId: string, materialTypeId: string;

  beforeAll(async () => {
    siteId = await firstSiteId();
    gate = await makeUser({ username: "gi-gate", role: "gate", siteId });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("creates supplier + visit + transitions state in one logical step", async () => {
    const { data: sup, error: supErr } = await gate.client
      .from("suppliers")
      .insert({ name: "Action Test Supp", phone: "07066660000", created_by: gate.userId })
      .select("id")
      .single();
    expect(supErr).toBeNull();

    const { data: v, error: vErr } = await gate.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: sup!.id,
        declared_material_type_id: materialTypeId,
        vehicle_plate: "TEST-001",
        entry_path: "unprocessed",
        state: "at_gate_in",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    expect(vErr).toBeNull();

    const { error: tErr } = await gate.client
      .from("visits")
      .update({ state: "in_processing" })
      .eq("id", v!.id);
    expect(tErr).toBeNull();

    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", v!.id)
      .order("created_at");
    expect(events!.map((e) => e.event_type)).toEqual(["visit_created", "state_changed"]);
  });

  it("pre_processed path transitions to in_receiving", async () => {
    const { data: sup } = await gate.client
      .from("suppliers")
      .insert({ name: "Pre Supp", phone: "07077770000", created_by: gate.userId })
      .select("id")
      .single();
    const { data: v } = await gate.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: sup!.id,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "at_gate_in",
        created_by: gate.userId,
      })
      .select("id")
      .single();
    await gate.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    const { data: after } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", v!.id)
      .single();
    expect(after?.state).toBe("in_receiving");
  });
});
