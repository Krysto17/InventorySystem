import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("processing_records RLS + state transition", () => {
  let siteAId: string, siteBId: string;
  let gateA: TestUser, procA: TestUser, procB: TestUser;
  let supplierId: string, materialTypeId: string, machineAId: string;

  async function newOpenVisit(siteId: string) {
    const { data } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "in_processing",
        created_by: gateA.userId,
      })
      .select("id")
      .single();
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    gateA = await makeUser({ username: "pr-gate-a", role: "receiving", siteId: siteAId });
    procA = await makeUser({ username: "pr-proc-a", role: "processing", siteId: siteAId });
    procB = await makeUser({ username: "pr-proc-b", role: "processing", siteId: siteBId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "PR Supp", phone: "07022220000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: machine } = await adminClient()
      .from("machines")
      .insert({ site_id: siteAId, name: "PR Crusher", charge_basis: "weight", rate: 10 })
      .select("id")
      .single();
    machineAId = machine!.id as string;
  });

  it("processing at site A can insert when visit is in_processing", async () => {
    const vid = await newOpenVisit(siteAId);
    const { error } = await procA.client
      .from("processing_records")
      .insert({ visit_id: vid, recorded_by: procA.userId });
    expect(error).toBeNull();
  });

  it("processing insert transitions visit in_processing → in_receiving", async () => {
    const vid = await newOpenVisit(siteAId);
    await procA.client
      .from("processing_records")
      .insert({ visit_id: vid, recorded_by: procA.userId });
    const { data } = await adminClient()
      .from("visits")
      .select("state")
      .eq("id", vid)
      .single();
    expect(data?.state).toBe("in_receiving");
  });

  it("processing at site B cannot insert against site A visit", async () => {
    const vid = await newOpenVisit(siteAId);
    const { error } = await procB.client
      .from("processing_records")
      .insert({ visit_id: vid, recorded_by: procB.userId });
    expect(error).not.toBeNull();
  });

  it("non-processing role cannot insert", async () => {
    const vid = await newOpenVisit(siteAId);
    const { error } = await gateA.client
      .from("processing_records")
      .insert({ visit_id: vid, recorded_by: gateA.userId });
    expect(error).not.toBeNull();
  });

  it("processing_machine_usage cascades RLS via parent", async () => {
    const vid = await newOpenVisit(siteAId);
    const { data: pr } = await procA.client
      .from("processing_records")
      .insert({ visit_id: vid, recorded_by: procA.userId })
      .select("id")
      .single();
    const { error } = await procA.client.from("processing_machine_usage").insert({
      processing_record_id: pr!.id,
      machine_id: machineAId,
      measurement: 320,
      rate_snapshot: 10,
    });
    expect(error).toBeNull();
  });
});
