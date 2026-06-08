import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("transaction_events written by triggers", () => {
  let siteId: string, proc: TestUser, recv: TestUser, mgr: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "ew-proc", role: "processing", siteId });
    recv = await makeUser({ username: "ew-recv", role: "receiving", siteId });
    mgr = await makeUser({ username: "ew-mgr", role: "manager", siteId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "EW Supp", phone: "07066660001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("each action produces the correct event types", async () => {
    // Pre-processed visit created directly at in_receiving (no gate stage).
    const { data: v } = await proc.client
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state: "in_receiving",
        created_by: proc.userId,
      })
      .select("id")
      .single();
    await recv.client
      .from("analysis_records")
      .insert({ visit_id: v!.id, weight: 50, recorded_by: recv.userId });
    await mgr.client.from("pricing").insert({
      visit_id: v!.id,
      unit_price: 100,
      agreement_status: "agreed",
      payment_terms: "immediate",
      priced_by: mgr.userId,
    });

    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type, payload")
      .eq("visit_id", v!.id)
      .order("created_at");
    const types = events!.map((e) => e.event_type);
    expect(types.filter((t) => t === "visit_created").length).toBe(1);
    // in_receiving → pricing → in_accounting = 2 state changes
    expect(types.filter((t) => t === "state_changed").length).toBe(2);
    expect(types.filter((t) => t === "record_created").length).toBe(2);
  });

  it("client cannot directly insert transaction_events", async () => {
    const { error } = await proc.client.from("transaction_events").insert({
      visit_id: "00000000-0000-0000-0000-000000000000",
      event_type: "visit_created",
      payload: {},
    });
    expect(error).not.toBeNull();
  });
});
