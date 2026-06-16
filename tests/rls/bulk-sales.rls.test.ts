import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("bulk_sales RLS", () => {
  let siteAId: string, siteBId: string;
  let invA: TestUser, invB: TestUser, gateA: TestUser, owner: TestUser;
  let materialTypeId: string;

  async function insertPendingSale(siteId: string, userId: string) {
    const { data, error } = await adminClient()
      .from("bulk_sales")
      .insert({
        site_id: siteId,
        buyer_name: "Test Buyer",
        material_type_id: materialTypeId,
        grade: "B",
        weight: 100,
        unit_price: 200,
        recorded_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  // Seed enough stock for approval tests
  async function addStock(siteId: string, weight: number) {
    await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: "B",
      weight,
      direction: "in",
      reason: "purchase_intake",
    });
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    invA  = await makeUser({ username: "bs-inv-a",  role: "inventory", siteId: siteAId });
    invB  = await makeUser({ username: "bs-inv-b",  role: "inventory", siteId: siteBId });
    gateA = await makeUser({ username: "bs-gate-a", role: "receiving",      siteId: siteAId });
    owner = await makeUser({ username: "bs-owner",  role: "owner",     siteId: null });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    // Pre-seed stock so approval tests can pass the balance check
    await addStock(siteAId, 5000);
  });

  it("inventory at site A can create a bulk sale for site A", async () => {
    const { error } = await invA.client.from("bulk_sales").insert({
      site_id: siteAId,
      buyer_name: "Buyer A",
      material_type_id: materialTypeId,
      weight: 50,
      unit_price: 100,
      recorded_by: invA.userId,
    });
    expect(error).toBeNull();
  });

  it("inventory at site B cannot create a sale for site A", async () => {
    const { error } = await invB.client.from("bulk_sales").insert({
      site_id: siteAId,
      buyer_name: "Buyer Hack",
      material_type_id: materialTypeId,
      weight: 10,
      unit_price: 100,
      recorded_by: invB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("non-inventory role cannot create a bulk sale", async () => {
    const { error } = await gateA.client.from("bulk_sales").insert({
      site_id: siteAId,
      buyer_name: "Gate Buyer",
      material_type_id: materialTypeId,
      weight: 10,
      unit_price: 50,
      recorded_by: gateA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("inventory can read own site bulk sales", async () => {
    await insertPendingSale(siteAId, invA.userId);
    const { data, error } = await invA.client
      .from("bulk_sales")
      .select("id")
      .eq("site_id", siteAId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("inventory at site A cannot read site B bulk sales", async () => {
    await insertPendingSale(siteBId, invB.userId);
    const { data } = await invA.client
      .from("bulk_sales")
      .select("id")
      .eq("site_id", siteBId);
    expect(data?.length).toBe(0);
  });

  it("non-owner cannot approve a bulk sale", async () => {
    const id = await insertPendingSale(siteAId, invA.userId);
    // Supabase RLS UPDATE denials return no error — they silently update 0 rows.
    await invA.client
      .from("bulk_sales")
      .update({ approval_status: "approved", approved_by: invA.userId })
      .eq("id", id);
    // Confirm the row was NOT changed
    const { data } = await adminClient()
      .from("bulk_sales")
      .select("approval_status")
      .eq("id", id)
      .single();
    expect(data?.approval_status).toBe("pending");
  });

  it("owner can approve a pending bulk sale and stock decrements", async () => {
    const id = await insertPendingSale(siteAId, invA.userId);

    // Check stock before
    const { data: before } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteAId)
      .eq("material_type_id", materialTypeId);
    const balanceBefore = (before ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)),
      0,
    );

    const { error } = await owner.client
      .from("bulk_sales")
      .update({ approval_status: "approved", approved_by: owner.userId, approved_at: new Date().toISOString() })
      .eq("id", id);
    expect(error).toBeNull();

    // Confirm stock_movements 'out' row was created
    const { data: after } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteAId)
      .eq("material_type_id", materialTypeId);
    const balanceAfter = (after ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)),
      0,
    );
    expect(balanceAfter).toBeLessThan(balanceBefore);
  });

  it("owner can read bulk sales across all sites", async () => {
    const { data, error } = await owner.client.from("bulk_sales").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});
