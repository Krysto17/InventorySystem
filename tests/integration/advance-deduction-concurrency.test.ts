import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

/**
 * H3: a supplier's debt cannot be deducted twice because two requests arrived
 * together.
 *
 * `_advance_deductions_guard` is a BEFORE INSERT trigger that asks
 * supplier_outstanding_debt() / supplier_processing_debt() what is left, and
 * lets the row in if the amount fits — holding nothing. Both figures are
 * DERIVED: sums over advances, advance_shares, advance_deductions and
 * utility_charges. There is no stored balance, so before 0153 there was nothing
 * to lock. Two concurrent deductions read the same outstanding amount, both
 * pass, both insert. Reproduced on a 50,000 advance: two concurrent
 * full-balance deductions both landed, 100,000 recorded, outstanding -50,000.
 *
 * The error direction is what makes it matter — the company deducts more from a
 * payout than the supplier owes. CLAUDE.md says over-deduction is "blocked in
 * DB"; that was true single-threaded and false under concurrency.
 *
 * 0153 locks the suppliers row before computing the balance. Every assertion
 * here reads the resulting OUTSTANDING BALANCE back, not just the errors.
 */
describe("advance deduction concurrency", () => {
  let manager: TestUser;
  let siteId: string;
  const stamp = Date.now();

  const outstanding = async (supplierId: string) => {
    const { data, error } = await adminClient()
      .rpc("supplier_outstanding_debt", { _supplier_id: supplierId } as never);
    expect(error, `outstanding: ${error?.message}`).toBeNull();
    return Number(data);
  };

  const deductedTotal = async (supplierId: string, kind = "advance") => {
    const { data } = await adminClient().from("advance_deductions")
      .select("amount").eq("supplier_id", supplierId).eq("kind", kind);
    return (data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  };

  /** A supplier owing exactly `amount` from one paid advance. */
  async function supplierOwing(amount: number) {
    const admin = adminClient();
    const { data: sup, error: sErr } = await admin.from("suppliers")
      .insert({ name: `ADV ${stamp}-${Math.random()}` }).select("id").single();
    expect(sErr, `supplier fixture: ${sErr?.message}`).toBeNull();
    const { error: aErr } = await admin.from("advances").insert({
      supplier_id: sup!.id, site_id: siteId, purpose: "concurrency fixture",
      amount_naira: amount, approval_status: "paid",
    });
    expect(aErr, `advance fixture: ${aErr?.message}`).toBeNull();
    return sup!.id as string;
  }

  /** A supplier with no advance and no carried bill — owes nothing at all. */
  async function supplierOwingNothing() {
    const { data, error } = await adminClient().from("suppliers")
      .insert({ name: `ADV ${stamp}-${Math.random()}` }).select("id").single();
    expect(error, `supplier fixture: ${error?.message}`).toBeNull();
    return data!.id as string;
  }

  const deduct = (supplierId: string, amount: number, kind = "advance") =>
    manager.client.from("advance_deductions")
      .insert({ supplier_id: supplierId, site_id: siteId, amount, kind });

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name");
    siteId = sites!.find((s) => s.name === "Dong")!.id as string;
    // Recording a deduction against a payout is the manager's lane.
    manager = await makeUser({ username: `advdeduct-${stamp}`, role: "manager", siteId });
  });

  // ── The guard still works normally ───────────────────────────────────────
  it("a deduction within the outstanding debt succeeds", async () => {
    const s = await supplierOwing(50_000);
    expect((await deduct(s, 20_000)).error).toBeNull();
    expect(await outstanding(s)).toBe(30_000);
  });

  it("a deduction exceeding the outstanding debt is refused, and writes nothing", async () => {
    const s = await supplierOwing(10_000);
    const { error } = await deduct(s, 10_001);
    expect(error, "over-deduction must be refused").not.toBeNull();
    expect(await outstanding(s), "a refused deduction must leave the balance alone").toBe(10_000);
    expect(await deductedTotal(s), "the rejected insert must leave no row").toBe(0);
  });

  it("an exact-balance deduction clears the debt to zero", async () => {
    const s = await supplierOwing(25_000);
    expect((await deduct(s, 25_000)).error).toBeNull();
    expect(await outstanding(s)).toBe(0);
  });

  // ── The race ─────────────────────────────────────────────────────────────
  it("two concurrent full-balance deductions recover the debt exactly once", async () => {
    for (let trial = 1; trial <= 3; trial++) {
      const s = await supplierOwing(50_000);
      const results = await Promise.all([deduct(s, 50_000), deduct(s, 50_000)]);
      const ok = results.filter((r) => !r.error).length;
      expect(ok, `trial ${trial}: only one may recover the debt`).toBe(1);
      expect(await deductedTotal(s), `trial ${trial}: total deducted`).toBe(50_000);
      expect(await outstanding(s), `trial ${trial}: must never go negative`).toBe(0);
    }
  });

  it("processing debt is protected the same way", async () => {
    // supplier_processing_debt is a different aggregate (carried light bills),
    // guarded by the same trigger — it must not be left behind.
    const s = await supplierOwingNothing();
    const { error } = await deduct(s, 1, "processing");
    expect(error, "a processing deduction with no carried bill must be refused").not.toBeNull();
    expect(await deductedTotal(s, "processing")).toBe(0);
  });

  it("concurrent partial deductions all land, and never exceed the debt", async () => {
    // The lock must serialise legitimate work, not refuse it.
    const s = await supplierOwing(50_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => deduct(s, 5_000)));
    expect(results.filter((r) => r.error), "every valid partial must land").toHaveLength(0);
    expect(await deductedTotal(s)).toBe(50_000);
    expect(await outstanding(s)).toBe(0);
  });

  it("different suppliers do not block each other", async () => {
    const a = await supplierOwing(30_000);
    const b = await supplierOwing(30_000);
    const results = await Promise.all([deduct(a, 30_000), deduct(b, 30_000)]);
    expect(results.filter((r) => r.error), "independent suppliers must both succeed").toHaveLength(0);
    expect(await outstanding(a)).toBe(0);
    expect(await outstanding(b)).toBe(0);
  });
});
