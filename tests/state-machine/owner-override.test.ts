import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// 0159 removed the owner's blanket state-machine bypass. It had never been used
// in production (no owner_override event, ever); the owner now moves a visit only
// through the workflows that own each transition.
describe("owner override is gone", () => {
  let siteId: string, owner: TestUser;
  let supplierId: string, materialTypeId: string;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
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

  it("the owner cannot move a visit backward, and no owner_override event is written", async () => {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "unprocessed",
        state: "in_receiving",
        created_by: owner.userId,
      })
      .select("id")
      .single();

    const { error } = await owner.client.from("visits").update({ state: "in_processing" }).eq("id", v!.id);
    expect(error?.code).toBe("VT001");

    const { data: after } = await adminClient().from("visits").select("state").eq("id", v!.id).single();
    expect(after!.state).toBe("in_receiving");
    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", v!.id);
    expect(events!.map((e) => e.event_type)).not.toContain("owner_override");
    expect(events!.map((e) => e.event_type)).not.toContain("state_changed");
  });
});
