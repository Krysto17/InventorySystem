import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("analysis_records RLS + state transition", () => {
  let siteAId: string;
  let recvA: TestUser, procA: TestUser;
  let supplierId: string, materialTypeId: string;

  async function newReceivingVisit() {
    const { data } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteAId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_receiving",
        created_by: recvA.userId,
      })
      .select("id")
      .single();
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteAId = sites![0].id as string;
    recvA = await makeUser({ username: "ar-recv-a", role: "receiving", siteId: siteAId });
    procA = await makeUser({ username: "ar-proc-a", role: "processing", siteId: siteAId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "AR Supp", phone: "07033330000" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("receiving can insert analysis on in_receiving visit at own site", async () => {
    const vid = await newReceivingVisit();
    const { error } = await recvA.client.from("analysis_records").insert({
      visit_id: vid,
      weight: 305,
      grade: "B+",
      purity: 58,
      recorded_by: recvA.userId,
    });
    expect(error).toBeNull();
  });

  it("analysis insert transitions in_receiving → pricing", async () => {
    const vid = await newReceivingVisit();
    await recvA.client
      .from("analysis_records")
      .insert({ visit_id: vid, weight: 305, recorded_by: recvA.userId });
    const { data } = await adminClient().from("visits").select("state").eq("id", vid).single();
    expect(data?.state).toBe("pricing");
  });

  it("non-receiving role cannot insert analysis", async () => {
    const vid = await newReceivingVisit();
    const { error } = await procA.client.from("analysis_records").insert({
      visit_id: vid,
      weight: 305,
      recorded_by: procA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("receiving cannot insert analysis when visit is not in_receiving", async () => {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteAId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "in_processing",
        created_by: recvA.userId,
      })
      .select("id")
      .single();
    const { error } = await recvA.client.from("analysis_records").insert({
      visit_id: v!.id,
      weight: 305,
      recorded_by: recvA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("editing weight writes a record_edited event", async () => {
    const vid = await newReceivingVisit();
    const { data: rec } = await recvA.client
      .from("analysis_records")
      .insert({ visit_id: vid, weight: 305, recorded_by: recvA.userId })
      .select("id")
      .single();
    await recvA.client
      .from("analysis_records")
      .update({ weight: 310 })
      .eq("id", rec!.id);
    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type, payload")
      .eq("visit_id", vid)
      .eq("event_type", "record_edited");
    expect(events!.length).toBeGreaterThan(0);
    const diff = (
      events![0].payload as { diff: { weight?: { old: number; new: number } } }
    ).diff;
    expect(diff.weight).toEqual({ old: 305, new: 310 });
  });
});
