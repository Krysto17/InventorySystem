import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("stock_movements RLS", () => {
  let siteAId: string, siteBId: string;
  let invA: TestUser, invB: TestUser, gateA: TestUser, owner: TestUser;
  let materialTypeId: string;

  async function addStock(siteId: string, weight: number, userId: string) {
    const { data, error } = await adminClient()
      .from("stock_movements")
      .insert({
        site_id: siteId,
        material_type_id: materialTypeId,
        grade: "A",
        weight,
        direction: "in",
        reason: "purchase_intake",
        recorded_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    invA  = await makeUser({ username: "stk-inv-a",  role: "inventory", siteId: siteAId });
    invB  = await makeUser({ username: "stk-inv-b",  role: "inventory", siteId: siteBId });
    gateA = await makeUser({ username: "stk-gate-a", role: "gate",      siteId: siteAId });
    owner = await makeUser({ username: "stk-owner",  role: "owner",     siteId: null });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("inventory at site A can insert purchase_intake for site A", async () => {
    const { error } = await invA.client.from("stock_movements").insert({
      site_id: siteAId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 50,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: invA.userId,
    });
    expect(error).toBeNull();
  });

  it("inventory at site B cannot insert for site A", async () => {
    const { error } = await invB.client.from("stock_movements").insert({
      site_id: siteAId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 50,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: invB.userId,
    });
    expect(error).not.toBeNull();
  });

  it("non-inventory role cannot insert", async () => {
    const { error } = await gateA.client.from("stock_movements").insert({
      site_id: siteAId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 50,
      direction: "in",
      reason: "purchase_intake",
      recorded_by: gateA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("inventory cannot insert adjustment reason (owner-only)", async () => {
    const { error } = await invA.client.from("stock_movements").insert({
      site_id: siteAId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 10,
      direction: "in",
      reason: "adjustment",
      recorded_by: invA.userId,
    });
    expect(error).not.toBeNull();
  });

  it("owner can insert adjustment", async () => {
    const { error } = await owner.client.from("stock_movements").insert({
      site_id: siteAId,
      material_type_id: materialTypeId,
      grade: "A",
      weight: 10,
      direction: "in",
      reason: "adjustment",
      recorded_by: owner.userId,
    });
    expect(error).toBeNull();
  });

  it("inventory at site A can read own site movements", async () => {
    await addStock(siteAId, 100, invA.userId);
    const { data, error } = await invA.client
      .from("stock_movements")
      .select("id")
      .eq("site_id", siteAId);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("inventory at site A cannot read site B movements", async () => {
    await addStock(siteBId, 100, invB.userId);
    const { data } = await invA.client
      .from("stock_movements")
      .select("id")
      .eq("site_id", siteBId);
    expect(data?.length).toBe(0);
  });

  it("owner can read movements across all sites", async () => {
    const { data, error } = await owner.client.from("stock_movements").select("id");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});
