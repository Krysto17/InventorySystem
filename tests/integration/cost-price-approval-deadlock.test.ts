import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * Two cost-price approvals must not deadlock against each other.
 *
 * 0153 guards the stock balance with an advisory lock per (site, material,
 * grade), taken by the BEFORE INSERT trigger on stock_movements. The approval
 * loop already locks each stock_lot `for update`, so taking the bucket inside
 * that loop put the two resources in opposite orders:
 *
 *     X: lock lot A -> lock bucket -> wants lot B
 *     Y: lock lot B ---------------> wants bucket
 *
 * which PostgreSQL resolves by aborting one with 40P01. Reproduced
 * deterministically before the ordering fix. Nothing prevents two pending runs
 * from sharing a lot: the key on cost_price_run_lots is (run_id, stock_lot_id)
 * and no trigger objects.
 *
 * The fix takes every bucket the run touches first, in a deterministic order,
 * making the global order bucket -> lot. A run is not one bucket — 15 of 32
 * production runs span two sites — so the buckets are ordered among themselves
 * too, and the lots likewise.
 *
 * This asserts the OUTCOME, not merely that both promises settled: 40P01 must
 * not appear, one approval wins, and the stock never goes negative.
 */
describe("cost-price approval lock ordering", () => {
  let owner: TestUser;
  let siteA: string, siteB: string, materialTypeId: string;
  const stamp = Date.now();

  const DEADLOCK = "40P01";

  const balance = async (site: string) => {
    const { data } = await adminClient().from("stock_movements")
      .select("weight, direction").eq("site_id", site).eq("material_type_id", materialTypeId);
    return (data ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)), 0);
  };

  async function lot(site: string, kg: number) {
    const { data } = await adminClient().from("stock_movements").insert({
      site_id: site, material_type_id: materialTypeId, grade: null,
      weight: kg, direction: "in", reason: "purchase_intake",
    }).select("id");
    expect(data).not.toBeNull();
    const { data: l } = await adminClient().from("stock_lots").insert({
      site_id: site, material_type_id: materialTypeId,
      weight_kg: kg, status: "available", cost_price_per_kg: 5,
    }).select("id").single();
    return l!.id as string;
  }

  async function run(label: string, lots: string[], site: string) {
    const { data: r } = await adminClient().from("cost_price_runs").insert({
      site_id: site, label, material_type_id: materialTypeId,
      approval_status: "pending", sold: true,
    }).select("id").single();
    await adminClient().from("cost_price_run_lots")
      .insert(lots.map((id) => ({ run_id: r!.id as string, stock_lot_id: id })));
    return r!.id as string;
  }

  const approve = (runId: string) =>
    owner.client.from("cost_price_runs")
      .update({ approval_status: "approved" }).eq("id", runId).select("id");

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    siteA = sites!.find((s) => s.name === "Dong")!.id as string;
    siteB = sites!.find((s) => s.name === "Old-Site")!.id as string;
    const { data: mt } = await admin.from("material_types")
      .insert({ name: `Deadlock ${stamp}` }).select("id").single();
    materialTypeId = mt!.id as string;
    owner = await makeUser({ username: `deadlock-${stamp}`, role: "owner", siteId: null });
  });

  afterAll(async () => {
    const admin = adminClient();
    await admin.from("cost_price_run_lots").delete()
      .in("stock_lot_id",
        ((await admin.from("stock_lots").select("id").eq("material_type_id", materialTypeId)).data ?? [])
          .map((l) => l.id as string));
    await admin.from("cost_price_runs").delete().eq("material_type_id", materialTypeId);
    await admin.from("stock_lots").delete().eq("material_type_id", materialTypeId);
    await admin.from("stock_movements").delete().eq("material_type_id", materialTypeId);
  });

  it("two approvals sharing a lot do not deadlock", async () => {
    // X = {shared, extraX}, Y = {shared}. One shared lot is enough for the
    // inverse order to bite once the bucket is taken mid-loop.
    for (let trial = 1; trial <= 3; trial++) {
      const shared = await lot(siteA, 10);
      const extraX = await lot(siteA, 10);
      const runX = await run(`dl-x-${stamp}-${trial}`, [shared, extraX], siteA);
      const runY = await run(`dl-y-${stamp}-${trial}`, [shared], siteA);

      const [x, y] = await Promise.all([approve(runX), approve(runY)]);

      for (const [name, res] of [["X", x], ["Y", y]] as const) {
        expect(res.error?.code, `trial ${trial}: approval ${name} must not deadlock`).not.toBe(DEADLOCK);
        expect(res.error?.message ?? "", `trial ${trial}: ${name}`).not.toMatch(/deadlock/i);
      }
      // Exactly one may take the shared lot; the other must be refused cleanly.
      const winners = [x, y].filter((r) => !r.error).length;
      expect(winners, `trial ${trial}: one approval wins, the other is refused`).toBe(1);
      expect(await balance(siteA), `trial ${trial}: stock must not go negative`)
        .toBeGreaterThanOrEqual(0);
    }
  });

  it("two multi-site approvals over the same pair of buckets do not deadlock", async () => {
    // Both runs touch site A and site B. If the buckets were taken in the order
    // each run happened to see them, these two could take them opposite ways.
    for (let trial = 1; trial <= 3; trial++) {
      const xa = await lot(siteA, 10), xb = await lot(siteB, 10);
      const ya = await lot(siteA, 10), yb = await lot(siteB, 10);
      const runX = await run(`dl-mx-${stamp}-${trial}`, [xa, xb], siteA);
      const runY = await run(`dl-my-${stamp}-${trial}`, [yb, ya], siteB);

      const [x, y] = await Promise.all([approve(runX), approve(runY)]);

      for (const [name, res] of [["X", x], ["Y", y]] as const) {
        expect(res.error?.code, `trial ${trial}: ${name} must not deadlock`).not.toBe(DEADLOCK);
        expect(res.error?.message ?? "", `trial ${trial}: ${name}`).not.toMatch(/deadlock/i);
      }
      // These runs share no lots, so both should complete.
      expect([x.error, y.error].filter(Boolean), `trial ${trial}: both should succeed`).toHaveLength(0);
      expect(await balance(siteA)).toBeGreaterThanOrEqual(0);
      expect(await balance(siteB)).toBeGreaterThanOrEqual(0);
    }
  });
});
