import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

describe("stock aggregation", () => {
  let siteId: string;
  let inv: TestUser;
  let materialTypeId: string;
  const GRADE = "agg-test";

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(1);
    siteId = sites![0].id as string;
    inv = await makeUser({ username: "agg-inv", role: "inventory", siteId });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;

    // Seed: 300 in, 80 out → expected balance 220
    await adminClient().from("stock_movements").insert([
      { site_id: siteId, material_type_id: materialTypeId, grade: GRADE, weight: 300, direction: "in",  reason: "purchase_intake" },
      { site_id: siteId, material_type_id: materialTypeId, grade: GRADE, weight: 80,  direction: "out", reason: "adjustment" },
    ]);
  });

  it("balance = sum(in) - sum(out) per (site, material, grade)", async () => {
    const { data } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteId)
      .eq("material_type_id", materialTypeId)
      .eq("grade", GRADE);

    const balance = (data ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)),
      0,
    );

    expect(balance).toBe(220);
  });

  it("inventory role can read their own stock_movements for aggregation", async () => {
    const { data, error } = await inv.client
      .from("stock_movements")
      .select("weight, direction, grade")
      .eq("site_id", siteId)
      .eq("material_type_id", materialTypeId)
      .eq("grade", GRADE);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("different grades bucket separately", async () => {
    const GRADE_B = "agg-gradeB";
    await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId,
      grade: GRADE_B, weight: 500, direction: "in", reason: "purchase_intake",
    });

    const { data } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteId)
      .eq("material_type_id", materialTypeId)
      .eq("grade", GRADE_B);

    const balance = (data ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)),
      0,
    );
    expect(balance).toBe(500);
  });
});
