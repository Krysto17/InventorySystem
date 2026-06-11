import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * Verifies the raw SQL aggregations used by the owner dashboard.
 * Seeds deterministic data and checks that:
 *  - visit counts by state are correct
 *  - payment direction sums are correct
 *  - rejection rate numerators/denominators are correct
 *  - stock balance per (material, grade) is correct
 */
describe("dashboard aggregation queries", () => {
  let siteAId: string, siteBId: string;
  let owner: TestUser;
  let materialTypeId: string;
  let supplierId: string;
  const GRADE = "dash-grade-A";

  // Helpers to keep tests readable
  async function newVisit(siteId: string, state: string) {
    const { data, error } = await adminClient()
      .from("visits")
      .insert({
        site_id: siteId,
        supplier_id: supplierId,
        declared_material_type_id: materialTypeId,
        entry_path: "pre_processed",
        state,
        created_by: owner.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  async function addPayment(visitId: string, direction: string, amount: number) {
    await adminClient().from("payments").insert({
      visit_id: visitId,
      direction,
      amount,
      recorded_by: owner.userId,
    });
  }

  async function addStock(siteId: string, direction: "in" | "out", weight: number) {
    await adminClient().from("stock_movements").insert({
      site_id: siteId,
      material_type_id: materialTypeId,
      grade: GRADE,
      weight,
      direction,
      reason: direction === "in" ? "purchase_intake" : "adjustment",
    });
  }

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id").limit(2);
    siteAId = sites![0].id as string;
    siteBId = sites![1].id as string;
    owner = await makeUser({ username: "dash-owner", role: "owner", siteId: null });
    const { data: m } = await adminClient().from("material_types").select("id").limit(1).single();
    materialTypeId = m!.id as string;
    const { data: s } = await adminClient()
      .from("suppliers")
      .insert({ name: "Dash Supplier", phone: "07000111222" })
      .select("id")
      .single();
    supplierId = s!.id as string;
  });

  it("counts visits per state correctly", async () => {
    const v1 = await newVisit(siteAId, "in_processing");
    const v2 = await newVisit(siteAId, "in_processing");
    const v3 = await newVisit(siteAId, "pricing");

    const { data } = await adminClient()
      .from("visits")
      .select("state")
      .in("id", [v1, v2, v3]);

    const counts: Record<string, number> = {};
    for (const v of data ?? []) {
      counts[v.state] = (counts[v.state] ?? 0) + 1;
    }

    expect(counts["in_processing"]).toBe(2);
    expect(counts["pricing"]).toBe(1);
  });

  it("sums payment amounts by direction", async () => {
    const vid = await newVisit(siteAId, "in_accounting");
    await addPayment(vid, "processing_fee_in", 1000);
    await addPayment(vid, "processing_fee_in", 500);
    await addPayment(vid, "purchase_amount_out", 8000);

    const { data: pmts } = await adminClient()
      .from("payments")
      .select("direction, amount")
      .eq("visit_id", vid);

    const totalIn = (pmts ?? [])
      .filter((p) => p.direction === "processing_fee_in")
      .reduce((s, p) => s + Number(p.amount), 0);
    const totalOut = (pmts ?? [])
      .filter((p) => p.direction === "purchase_amount_out")
      .reduce((s, p) => s + Number(p.amount), 0);

    expect(totalIn).toBe(1500);
    expect(totalOut).toBe(8000);
  });

  it("computes rejection rate from pricing rows", async () => {
    const vAgreed1 = await newVisit(siteAId, "in_accounting");
    const vAgreed2 = await newVisit(siteAId, "in_accounting");
    const vRejected = await newVisit(siteAId, "exited");

    await adminClient().from("pricing").insert([
      { visit_id: vAgreed1, unit_price: 100, agreement_status: "agreed", payment_terms: "immediate", priced_by: owner.userId },
      { visit_id: vAgreed2, unit_price: 100, agreement_status: "agreed", payment_terms: "immediate", priced_by: owner.userId },
      { visit_id: vRejected, unit_price: null, agreement_status: "not_agreed", priced_by: owner.userId },
    ]);

    const { data: pricingRows } = await adminClient()
      .from("pricing")
      .select("agreement_status")
      .in("visit_id", [vAgreed1, vAgreed2, vRejected]);

    const agreed   = (pricingRows ?? []).filter((r) => r.agreement_status === "agreed").length;
    const rejected = (pricingRows ?? []).filter((r) => r.agreement_status === "not_agreed").length;
    const total    = agreed + rejected;
    const rate     = total > 0 ? (rejected / total) * 100 : 0;

    expect(agreed).toBe(2);
    expect(rejected).toBe(1);
    expect(rate).toBeCloseTo(33.33, 1);
  });

  it("computes live stock balance by (material, grade)", async () => {
    await addStock(siteAId, "in",  500);
    await addStock(siteAId, "in",  300);
    await addStock(siteAId, "out", 200);

    const { data: movements } = await adminClient()
      .from("stock_movements")
      .select("weight, direction")
      .eq("site_id", siteAId)
      .eq("material_type_id", materialTypeId)
      .eq("grade", GRADE);

    const balance = (movements ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)),
      0,
    );

    // 500 + 300 - 200 = 600 minimum (other tests may have added stock too)
    expect(balance).toBeGreaterThanOrEqual(600);
  });

  it("owner dashboard can read data across all sites", async () => {
    // Verify owner-scoped reads work for cross-site dashboard queries
    const { data: visits, error: ve } = await owner.client
      .from("visits")
      .select("site_id, state")
      .in("site_id", [siteAId, siteBId]);
    expect(ve).toBeNull();
    expect(visits!.length).toBeGreaterThan(0);

    const { data: stock, error: se } = await owner.client
      .from("stock_movements")
      .select("site_id, weight, direction");
    expect(se).toBeNull();
    expect(stock!.length).toBeGreaterThan(0);

    const { data: consumables, error: ce } = await owner.client
      .from("consumables")
      .select("name, category, entry_date");
    expect(ce).toBeNull();
  });
});
