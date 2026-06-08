import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("owner-override events", () => {
  let siteId: string, proc: TestUser, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    proc = await makeUser({ username: "oo-proc", role: "processing", siteId });
    owner = await makeUser({ username: "oo-owner", role: "owner", siteId: null });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "OO Supp", phone: "07044440001" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("owner backward state move writes owner_override", async () => {
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
    await proc.client.from("visits").update({ state: "in_receiving" }).eq("id", v!.id);
    await owner.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);

    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", v!.id)
      .order("created_at");
    expect(events!.map((e) => e.event_type)).toContain("owner_override");
  });
});
