import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("bulk sale owner approval flow", () => {
  let siteId: string;
  let inv: TestUser, owner: TestUser;
  let materialTypeId: string;

  async function seedStock(weight: number) {
    await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "A",
      weight,
      direction: "in",
      reason: "purchase_intake",
    });
  }

  async function newPendingSale(weight: number) {
    const { data, error } = await adminClient()
      .from("bulk_sales")
      .insert({
        site_id: siteId,
        buyer_name: "Bulk Buyer",
        material_type_id: materialTypeId,
        grade: "A",
        weight,
        unit_price: 300,
        recorded_by: inv.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    inv   = await makeUser({ username: "bsoa-inv",   role: "inventory", siteId });
    owner = await makeUser({ username: "bsoa-owner", role: "owner",     siteId: null });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    await seedStock(10000); // large pool so tests don't fight over stock
  });

  it("pending bulk sale does NOT decrement stock", async () => {
    const { data: before } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteId)
      .eq("material_type_id", materialTypeId);

    await newPendingSale(50);

    const { data: after } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteId)
      .eq("material_type_id", materialTypeId);

    expect(after!.length).toBe(before!.length); // no new stock_movement row
  });

  it("owner approval writes an 'out' stock_movement", async () => {
    const id = await newPendingSale(100);

    const countBefore = (
      await adminClient()
        .from("stock_movements")
        .select("id")
        .eq("site_id", siteId)
        .eq("direction", "out")
    ).data?.length ?? 0;

    await adminClient()
      .from("bulk_sales")
      .update({
        approval_status: "approved",
        approved_by: owner.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);

    const countAfter = (
      await adminClient()
        .from("stock_movements")
        .select("id")
        .eq("site_id", siteId)
        .eq("direction", "out")
    ).data?.length ?? 0;

    expect(countAfter).toBe(countBefore + 1);
  });

  it("approved bulk sale out-movement has correct ref_bulk_sale_id", async () => {
    const id = await newPendingSale(75);

    await adminClient()
      .from("bulk_sales")
      .update({
        approval_status: "approved",
        approved_by: owner.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id);

    const { data: movement } = await adminClient()
      .from("stock_movements")
      .select("ref_bulk_sale_id, weight, direction")
      .eq("ref_bulk_sale_id", id)
      .single();

    expect(movement?.direction).toBe("out");
    expect(Number(movement?.weight)).toBe(75);
  });

  it("rejection does NOT write a stock_movement", async () => {
    const id = await newPendingSale(60);

    const countBefore = (
      await adminClient()
        .from("stock_movements")
        .select("id")
        .eq("site_id", siteId)
    ).data?.length ?? 0;

    await adminClient()
      .from("bulk_sales")
      .update({
        approval_status: "rejected",
        approved_by: owner.userId,
        approved_at: new Date().toISOString(),
        rejection_note: "Not enough demand",
      })
      .eq("id", id);

    const countAfter = (
      await adminClient()
        .from("stock_movements")
        .select("id")
        .eq("site_id", siteId)
    ).data?.length ?? 0;

    expect(countAfter).toBe(countBefore);
  });
});
