import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * H1: stock cannot be consumed twice because two requests arrived together.
 *
 * `_stock_movements_balance_check` is a BEFORE INSERT trigger that sums the
 * bucket, compares, and lets the row in — without holding anything. Under READ
 * COMMITTED neither transaction sees the other's uncommitted movement, so both
 * read the same balance, both pass, and both insert. Reproduced before 0153 on
 * a 100 kg bucket: two concurrent 100 kg 'out' movements both landed, leaving
 * the balance at -100 kg.
 *
 * The cost-price path already takes `for update` on each stock_lot, and that is
 * NOT enough: it protects lot identity — a lot cannot be sold twice — while the
 * invariant here is the aggregate weight of a (site, material, grade) bucket,
 * which other paths mutate. A cost-price approval racing an owner adjustment
 * was reproduced going negative in exactly that way, so that cross-path case is
 * tested below and is the one this suite exists for.
 *
 * 0153 takes a transaction-scoped advisory lock keyed to the bucket before the
 * read. Every assertion here reads the resulting BALANCE back — an error alone
 * proves nothing, because the danger is the total.
 */
describe("stock oversell concurrency", () => {
  let owner: TestUser;
  let siteId: string, materialTypeId: string;
  const stamp = Date.now();

  // The invariant's grain is (site_id, material_type_id, coalesce(grade,'')).
  // A private material type gives every test its own buckets, so nothing here
  // contends with another suite's stock.
  const bucket = (n: string) => `oversell-${stamp}-${n}`;

  const balance = async (grade: string | null) => {
    let q = adminClient().from("stock_movements")
      .select("weight, direction").eq("site_id", siteId).eq("material_type_id", materialTypeId);
    q = grade === null ? q.is("grade", null) : q.eq("grade", grade);
    const { data } = await q;
    return (data ?? []).reduce(
      (s, r) => s + (r.direction === "in" ? Number(r.weight) : -Number(r.weight)), 0);
  };

  const seed = async (grade: string | null, kg: number) => {
    const { error } = await adminClient().from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId, grade,
      weight: kg, direction: "in", reason: "purchase_intake",
    });
    expect(error, `seed: ${error?.message}`).toBeNull();
  };

  const takeOut = (grade: string | null, kg: number) =>
    owner.client.from("stock_movements").insert({
      site_id: siteId, material_type_id: materialTypeId, grade,
      weight: kg, direction: "out", reason: "adjustment",
    });

  beforeAll(async () => {
    const admin = adminClient();
    const { data: sites } = await admin.from("sites").select("id, name");
    siteId = sites!.find((s) => s.name === "Dong")!.id as string;
    const { data: mt, error: mtErr } = await admin.from("material_types")
      .insert({ name: `Oversell ${stamp}` }).select("id").single();
    expect(mtErr, `material fixture: ${mtErr?.message}`).toBeNull();
    materialTypeId = mt!.id as string;
    // Adjustments are the owner's lane (recordAdjustment is owner-only).
    owner = await makeUser({ username: `oversell-${stamp}`, role: "owner", siteId: null });
  });

  afterAll(async () => {
    await adminClient().from("stock_movements").delete().eq("material_type_id", materialTypeId);
  });

  // ── The guard still works normally ───────────────────────────────────────
  it("an 'out' movement within the balance succeeds", async () => {
    const g = bucket("within");
    await seed(g, 100);
    expect((await takeOut(g, 40)).error).toBeNull();
    expect(await balance(g)).toBe(60);
  });

  it("an 'out' movement exceeding the balance is refused, and writes nothing", async () => {
    const g = bucket("exceed");
    await seed(g, 50);
    const { error } = await takeOut(g, 51);
    expect(error, "over-consumption must be refused").not.toBeNull();
    expect(await balance(g), "a refused movement must leave the balance alone").toBe(50);
    const { data } = await adminClient().from("stock_movements")
      .select("id").eq("material_type_id", materialTypeId).eq("grade", g).eq("direction", "out");
    expect(data ?? [], "the rejected insert must leave no row").toHaveLength(0);
  });

  it("exact-balance consumption is allowed and leaves the bucket at zero", async () => {
    const g = bucket("exact");
    await seed(g, 75);
    expect((await takeOut(g, 75)).error).toBeNull();
    expect(await balance(g)).toBe(0);
  });

  // ── The race ─────────────────────────────────────────────────────────────
  it("two concurrent full-balance 'out' movements settle the stock exactly once", async () => {
    // Repeated: a single pass could win by luck rather than by the lock.
    for (let trial = 1; trial <= 3; trial++) {
      const g = bucket(`race-${trial}`);
      await seed(g, 100);
      const results = await Promise.all([takeOut(g, 100), takeOut(g, 100)]);
      const ok = results.filter((r) => !r.error).length;
      expect(ok, `trial ${trial}: exactly one may consume the stock`).toBe(1);
      expect(await balance(g), `trial ${trial}: the bucket must never go negative`).toBe(0);
    }
  });

  it("a cost-price approval racing an adjustment cannot drive the bucket negative", async () => {
    // The case the lot-level `for update` does NOT cover: the run locks its lot,
    // the adjustment locks nothing, and both read the same aggregate. Repeated,
    // because over HTTP the window is narrower than it is between two held
    // transactions — a single pass could miss the race rather than survive it.
    const admin = adminClient();
    for (let trial = 1; trial <= 3; trial++) {
      const { data: lot } = await admin.from("stock_lots").insert({
        site_id: siteId, material_type_id: materialTypeId,
        weight_kg: 100, status: "available", cost_price_per_kg: 10,
      }).select("id").single();
      const { data: run } = await admin.from("cost_price_runs").insert({
        site_id: siteId, label: `oversell-run-${stamp}-${trial}`, material_type_id: materialTypeId,
        approval_status: "pending", sold: true,
      }).select("id").single();
      await admin.from("cost_price_run_lots").insert({ run_id: run!.id, stock_lot_id: lot!.id });

      // 100 kg in the bucket, and two claims on it worth 100 kg each.
      await seed(null, 100);
      const before = await balance(null);
      const [approval, adjustment] = await Promise.all([
        owner.client.from("cost_price_runs")
          .update({ approval_status: "approved" }).eq("id", run!.id).select("id"),
        takeOut(null, 100),
      ]);

      const landed = [!approval.error, !adjustment.error].filter(Boolean).length;
      expect(landed, `trial ${trial}: only one may consume the same 100 kg`).toBe(1);
      expect(await balance(null), `trial ${trial}: the bucket must never go negative`)
        .toBe(before - 100);
      expect(await balance(null)).toBeGreaterThanOrEqual(0);
    }
  });

  it("concurrent partial movements all land, and never exceed the stock", async () => {
    // The lock must serialise legitimate work, not refuse it.
    const g = bucket("partials");
    await seed(g, 100);
    const results = await Promise.all(Array.from({ length: 10 }, () => takeOut(g, 10)));
    expect(results.filter((r) => r.error), "every valid partial must land").toHaveLength(0);
    expect(await balance(g)).toBe(0);
  });

  it("different buckets do not block each other", async () => {
    const a = bucket("indep-a"), b = bucket("indep-b");
    await seed(a, 100);
    await seed(b, 100);
    const results = await Promise.all([takeOut(a, 100), takeOut(b, 100)]);
    expect(results.filter((r) => r.error), "independent buckets must both succeed").toHaveLength(0);
    expect(await balance(a)).toBe(0);
    expect(await balance(b)).toBe(0);
  });
});
