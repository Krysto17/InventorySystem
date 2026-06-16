import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("edit-while-open: each role can edit own record on an open visit", () => {
  let siteId: string;
  let proc: TestUser, recv: TestUser, mgr: TestUser;
  let supplierId: string, materialTypeId: string;

  async function freshVisitInPricing() {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_receiving",
        created_by: proc.userId,
      })
      .select("id")
      .single();
    const { data: a } = await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 100, recorded_by: recv.userId })
      .select("id")
      .single();
    return { vid: v!.id as string, aid: a!.id as string };
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "ewo-proc", role: "processing", siteId });
    recv = await makeUser({ username: "ewo-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "ewo-mgr", role: "manager", siteId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "EWO Supp", phone: "07022220001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("receiving can edit analysis after the visit moves to pricing", async () => {
    const { vid, aid } = await freshVisitInPricing();
    const { error } = await recv.client
      .from("analysis_records")
      .update({ weight: 120 })
      .eq("id", aid);
    expect(error).toBeNull();
    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type, payload")
      .eq("visit_id", vid)
      .eq("event_type", "record_edited");
    expect(events!.length).toBeGreaterThan(0);
  });

  it("manager edit of unit_price writes record_edited with diff", async () => {
    const { vid } = await freshVisitInPricing();
    const { data: p } = await mgr.client
      .from("pricing")
      .insert({
        visit_id: vid,
        unit_price: 1000,
        agreement_status: "pending",
        priced_by: mgr.userId,
      })
      .select("id")
      .single();
    await mgr.client.from("pricing").update({ unit_price: 1100 }).eq("id", p!.id);
    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("payload")
      .eq("visit_id", vid)
      .eq("event_type", "record_edited")
      .order("created_at", { ascending: false })
      .limit(1);
    const diff = (
      events![0].payload as { diff?: { unit_price?: { old: number; new: number } } }
    ).diff;
    expect(diff?.unit_price).toEqual({ old: 1000, new: 1100 });
  });
});
