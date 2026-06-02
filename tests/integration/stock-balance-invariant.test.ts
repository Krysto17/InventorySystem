import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("stock balance invariant", () => {
  let siteId: string;
  let owner: TestUser;
  let materialTypeId: string;

  async function currentBalance(grade: string) {
    const { data } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteId)
      .eq("material_type_id", materialTypeId)
      .eq("grade", grade);
    return (data ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)),
      0,
    );
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    owner = await makeUser({ username: "inv-bal-owner", role: "owner", siteId: null });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
  });

  it("out movement within stock succeeds", async () => {
    // Seed 200 kg
    await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId,
      grade: "inv-test", weight: 200, direction: "in", reason: "adjustment",
    });

    const { error } = await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId,
      grade: "inv-test", weight: 100, direction: "out", reason: "adjustment",
    });

    expect(error).toBeNull();
    expect(await currentBalance("inv-test")).toBe(100);
  });

  it("out movement exceeding stock is rejected", async () => {
    await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId,
      grade: "inv-exceed", weight: 50, direction: "in", reason: "adjustment",
    });

    const { error } = await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId,
      grade: "inv-exceed", weight: 51, direction: "out", reason: "adjustment",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/insufficient stock/i);
  });

  it("out movement against zero stock is rejected", async () => {
    const { error } = await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId,
      grade: "inv-zero", weight: 10, direction: "out", reason: "adjustment",
    });

    expect(error).not.toBeNull();
  });

  it("bulk sale approval is blocked when stock is insufficient", async () => {
    // No extra stock seeded for this grade
    const { data: sale } = await adminClient()
      .from("bulk_sales")
      .insert({
        site_id: siteId,
        buyer_name: "Excess Buyer",
        material_type_id: materialTypeId,
        grade: "inv-nosale",
        weight: 9999,
        unit_price: 100,
      })
      .select("id")
      .single();

    const { error } = await adminClient()
      .from("bulk_sales")
      .update({
        approval_status: "approved",
        approved_by: owner.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", sale!.id);

    expect(error).not.toBeNull();
  });
});
