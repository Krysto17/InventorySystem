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
 * deterministically before the ordering fix. At the time nothing prevented two
 * pending runs from sharing a lot; since 0160 a pending run reserves its lots
 * (CP003), so that race is now refused at attach time instead.
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
      approval_status: "pending",
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

  // 0160: a pending run reserves its lots, so two approvals can no longer race
  // for one lot — the second run never gets it. What is left of the original
  // race is two approvals in the same bucket over different lots.
  it("a lot reserved by one pending run cannot join a second, so two approvals never share it", async () => {
    for (let trial = 1; trial <= 3; trial++) {
      const shared = await lot(siteA, 10);
      const extraX = await lot(siteA, 10);
      const extraY = await lot(siteA, 10);
      const runX = await run(`dl-x-${stamp}-${trial}`, [shared, extraX], siteA);

      const { data: ry } = await adminClient().from("cost_price_runs").insert({
        site_id: siteA, label: `dl-y-${stamp}-${trial}`, material_type_id: materialTypeId, approval_status: "pending",
      }).select("id").single();
      const refused = await adminClient().from("cost_price_run_lots")
        .insert({ run_id: ry!.id as string, stock_lot_id: shared });
      expect(refused.error?.code, `trial ${trial}: the shared lot is reserved`).toBe("CP003");
      expect((await adminClient().from("cost_price_run_lots")
        .insert({ run_id: ry!.id as string, stock_lot_id: extraY })).error).toBeNull();

      const [x, y] = await Promise.all([approve(runX), approve(ry!.id as string)]);

      for (const [name, res] of [["X", x], ["Y", y]] as const) {
        expect(res.error?.code, `trial ${trial}: approval ${name} must not deadlock`).not.toBe(DEADLOCK);
        expect(res.error?.message ?? "", `trial ${trial}: ${name}`).not.toMatch(/deadlock/i);
      }
      expect([x.error, y.error].filter(Boolean), `trial ${trial}: both approvals land`).toHaveLength(0);
      expect(await balance(siteA), `trial ${trial}: stock must not go negative`)
        .toBeGreaterThanOrEqual(0);
    }
  });

  it("two pending runs attaching the same lot at the same instant: exactly one reserves it", async () => {
    for (let trial = 1; trial <= 3; trial++) {
      const shared = await lot(siteA, 10);
      const ids: string[] = [];
      for (const n of ["p", "q"]) {
        const { data } = await adminClient().from("cost_price_runs").insert({
          site_id: siteA, label: `dl-${n}-${stamp}-${trial}`, material_type_id: materialTypeId, approval_status: "pending",
        }).select("id").single();
        ids.push(data!.id as string);
      }
      const results = await Promise.all(ids.map((id) =>
        adminClient().from("cost_price_run_lots").insert({ run_id: id, stock_lot_id: shared })));
      for (const r of results) expect(r.error?.code, `trial ${trial}`).not.toBe(DEADLOCK);
      expect(results.filter((r) => !r.error), `trial ${trial}: one reservation`).toHaveLength(1);
      expect(results.find((r) => r.error)!.error!.code).toBe("CP003");
      const { count } = await adminClient().from("cost_price_run_lots")
        .select("run_id", { count: "exact", head: true }).eq("stock_lot_id", shared);
      expect(count).toBe(1);
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
