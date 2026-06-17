import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("purchase intake flow", () => {
  let siteId: string;
  let inv: TestUser;
  let supplierId: string, materialTypeId: string;

  async function makeAwaitingIntakeVisit() {
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "awaiting_stock_intake",
        created_by: inv.userId,
      })
      .select("id")
      .single();
    return v!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    inv = await makeUser({ username: "pi-inv", role: "inventory", siteId });
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Intake Supplier", phone: "07033445566" })
      .select("id")
      .single();
    supplierId = s!.id as string;
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("inserting purchase_intake stock_movement transitions visit to stocked", async () => {
    const visitId = await makeAwaitingIntakeVisit();

    await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 150,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
      ref_visit_id: visitId,
    });

    const { data: visit } = await adminClient()
      .from("visits")
      .select("state, closed_at")
      .eq("id", visitId)
      .single();

    expect(visit?.state).toBe("stocked");
    expect(visit?.closed_at).not.toBeNull();
  });

  it("stocked visit gets a transaction_events audit row", async () => {
    const visitId = await makeAwaitingIntakeVisit();

    await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "B",
      weight: 80,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
      ref_visit_id: visitId,
    });

    const { data: events } = await adminClient()
      .from("transaction_events")
      .select("event_type")
      .eq("visit_id", visitId);

    const types = (events ?? []).map((e) => e.event_type);
    // Should have visit_created, state_changed (→stocked), record_created (stock_movements)
    expect(types).toContain("state_changed");
    expect(types).toContain("record_created");
  });

  it("inventory role can insert purchase_intake via RLS", async () => {
    const visitId = await makeAwaitingIntakeVisit();

    const { error } = await inv.client.from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 60,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
      ref_visit_id: visitId,
    });

    expect(error).toBeNull();
  });

  it("cannot insert purchase_intake for a visit at an early stage", async () => {
    // pricing/in_accounting → stocked is now legal (settlement-paid auto-stock),
    // so use an early state where → stocked is still illegal.
    const { data: v } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "processed",
        state: "in_receiving",
        created_by: inv.userId,
      })
      .select("id")
      .single();

    // Insert the intake — the trigger will try to UPDATE visits to 'stocked'
    // but in_accounting → stocked is not a legal transition
    const { error } = await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 10,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
      ref_visit_id: v!.id,
    });

    expect(error).not.toBeNull();
  });
});
