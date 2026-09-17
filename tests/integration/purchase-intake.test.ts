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

  // 0159 retired the July 2026 intake queue (awaiting_stock_intake → stocked) and
  // gave inventory no stage authority. A purchase_intake movement pointed at a visit
  // no longer stocks it: only the paid settlement's stock intake does.
  it("a purchase_intake movement can no longer stock a visit on its own", async () => {
    const visitId = await makeAwaitingIntakeVisit();

    const { error } = await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 150,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
      ref_visit_id: visitId,
    });
    expect(error?.code).toBe("VT001");

    const { data: visit } = await adminClient()
      .from("visits")
      .select("state, closed_at")
      .eq("id", visitId)
      .single();
    expect(visit?.state).toBe("awaiting_stock_intake");
    expect(visit?.closed_at).toBeNull();
  });

  it("the refused intake leaves no movement and no state change behind", async () => {
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
    expect((events ?? []).map((e) => e.event_type)).not.toContain("state_changed");
    const { data: movements } = await adminClient()
      .from("stock_movements").select("id").eq("ref_visit_id", visitId);
    expect(movements ?? []).toHaveLength(0);
  });

  it("inventory may still record purchase_intake stock via RLS, but not stock a visit with it", async () => {
    const plain = await inv.client.from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 60,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
    });
    expect(plain.error).toBeNull();

    const visitId = await makeAwaitingIntakeVisit();
    const toVisit = await inv.client.from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 60,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: inv.userId,
      ref_visit_id: visitId,
    });
    expect(toVisit.error?.code).toBe("VT001");
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
