import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("gate_exit_authorizations RLS", () => {
  let siteAId: string;
  let gateA: TestUser, mgrA: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newAwaitingExitVisit() {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteAId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "awaiting_gate_exit",
        created_by: gateA.userId,
      })
      .select("id")
      .single();
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteAId = sites![0].id as string;
    gateA = await makeUser({ username: "gea-gate-a", role: "gate", siteId: siteAId });
    mgrA = await makeUser({ username: "gea-mgr-a", role: "manager", siteId: siteAId });
    owner = await makeUser({ username: "gea-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "GEA Supp", phone: "07055550000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("owner can insert authorization", async () => {
    const vid = await newAwaitingExitVisit();
    const { error } = await owner.client.from("gate_exit_authorizations").insert({
      visit_id: vid,
      authorized_by: owner.userId,
      note: "ok to leave",
    });
    expect(error).toBeNull();
  });

  it("non-owner cannot insert authorization", async () => {
    const vid = await newAwaitingExitVisit();
    const { error } = await mgrA.client.from("gate_exit_authorizations").insert({
      visit_id: vid,
      authorized_by: mgrA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("gate at site A can read authorization", async () => {
    const vid = await newAwaitingExitVisit();
    await adminClient()
      .from("gate_exit_authorizations")
      .insert({ visit_id: vid, authorized_by: owner.userId });
    const { data, error } = await gateA.client
      .from("gate_exit_authorizations")
      .select("id")
      .eq("visit_id", vid);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("inserting authorization writes gate_exit_authorized event", async () => {
    const vid = await newAwaitingExitVisit();
    await owner.client.from("gate_exit_authorizations").insert({
      visit_id: vid,
      authorized_by: owner.userId,
      note: "audit-test",
    });
    const { data } = await adminClient()
      .from("transaction_events")
      .select("event_type, payload")
      .eq("visit_id", vid)
      .eq("event_type", "gate_exit_authorized");
    expect(data?.length).toBe(1);
    expect((data![0].payload as { note: string }).note).toBe("audit-test");
  });

  it("after authorization, gate can transition state to exited", async () => {
    const vid = await newAwaitingExitVisit();
    await owner.client.from("gate_exit_authorizations").insert({
      visit_id: vid,
      authorized_by: owner.userId,
    });
    const { error } = await gateA.client
      .from("visits")
      .update({ state: "exited" })
      .eq("id", vid);
    expect(error).toBeNull();
    const { data } = await adminClient()
      .from("visits")
      .select("state, closed_at")
      .eq("id", vid)
      .single();
    expect(data?.state).toBe("exited");
    expect(data?.closed_at).not.toBeNull();
  });

  it("without authorization, transition to exited is rejected", async () => {
    const vid = await newAwaitingExitVisit();
    const { error } = await gateA.client
      .from("visits")
      .update({ state: "exited" })
      .eq("id", vid);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/gate_exit_authorizations/);
  });
});
