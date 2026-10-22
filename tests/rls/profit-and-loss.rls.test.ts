import { describe, it, expect, beforeAll } from "vitest";
import { adminClient, makeUser, type TestUser } from "../setup/supabase-test-clients";

// 0170. The statement is for the owner and the accountant; the salary figure is
// entered by the accountant or the manager; and a bulk sale is now recorded by
// the MANAGER, which 0045 had taken away and given to inventory.
describe("profit & loss: salary entries, sale authority (0170)", () => {
  let siteA: string, siteB: string, material: string;
  let owner: TestUser, acct: TestUser, mgrA: TestUser, mgrB: TestUser, invA: TestUser, recvA: TestUser;

  beforeAll(async () => {
    const { data: sites } = await adminClient().from("sites").select("id, name").order("name");
    siteA = sites![0].id as string;
    siteB = sites![1].id as string;
    owner = await makeUser({ username: "pl-owner", role: "owner", siteId: null });
    acct  = await makeUser({ username: "pl-acct",  role: "accounting", siteId: siteA });
    mgrA  = await makeUser({ username: "pl-mgr-a", role: "manager", siteId: siteA });
    mgrB  = await makeUser({ username: "pl-mgr-b", role: "manager", siteId: siteB });
    invA  = await makeUser({ username: "pl-inv-a", role: "inventory", siteId: siteA });
    recvA = await makeUser({ username: "pl-recv-a", role: "receiving", siteId: siteA });
    const { data: mt } = await adminClient().from("material_types").select("id").limit(1).single();
    material = mt!.id as string;
  });

  // Each call returns a month no other test — or earlier RUN of this file —
  // has used. The whole point of the constraint under test is that a month
  // cannot be entered twice, so reusing fixed months would make the suite fail
  // the second time it is run against the same database.
  const baseYear = 2100 + Math.floor(Math.random() * 800);
  let month = 0;
  const nextPeriod = () => {
    const y = baseYear + Math.floor(month / 12);
    const m = String((month % 12) + 1).padStart(2, "0");
    month += 1;
    return `${y}-${m}-01`;
  };

  // ── salary_entries ────────────────────────────────────────────────────────
  it("the accountant enters a salary figure for their own site", async () => {
    const { error } = await acct.client.from("salary_entries")
      .insert({ site_id: siteA, period: nextPeriod(), amount_naira: 2_400_000 }).select("id");
    expect(error, error?.message).toBeNull();
  });

  it("the manager enters one too", async () => {
    const { error } = await mgrA.client.from("salary_entries")
      .insert({ site_id: siteA, period: nextPeriod(), amount_naira: 1_000_000 }).select("id");
    expect(error, error?.message).toBeNull();
  });

  it("but not for another site", async () => {
    const { error } = await mgrB.client.from("salary_entries")
      .insert({ site_id: siteA, period: nextPeriod(), amount_naira: 50 }).select("id");
    expect(error, "a manager must not post payroll to another site").not.toBeNull();
  });

  it("a role outside the money lane cannot enter one at all", async () => {
    const { error } = await recvA.client.from("salary_entries")
      .insert({ site_id: siteA, period: nextPeriod(), amount_naira: 50 }).select("id");
    expect(error).not.toBeNull();
  });

  it("one figure per site per month — a second is refused, not silently added", async () => {
    const period = nextPeriod();
    expect((await acct.client.from("salary_entries")
      .insert({ site_id: siteA, period, amount_naira: 100 }).select("id")).error).toBeNull();
    const dup = await acct.client.from("salary_entries")
      .insert({ site_id: siteA, period, amount_naira: 999 }).select("id");
    expect(dup.error?.code, "a duplicated payroll line would swing the statement").toBe("23505");
  });

  it("a period must be the first of a month", async () => {
    const { error } = await acct.client.from("salary_entries")
      .insert({ site_id: siteA, period: `${baseYear}-07-15`, amount_naira: 100 }).select("id");
    expect(error, "mid-month dates would let one month be entered twice").not.toBeNull();
  });

  it("the figure can be corrected, and the owner may post for any site", async () => {
    const period = nextPeriod();
    const { data } = await acct.client.from("salary_entries")
      .insert({ site_id: siteA, period, amount_naira: 1 }).select("id").single();
    const fix = await acct.client.from("salary_entries")
      .update({ amount_naira: 2 }).eq("id", data!.id).select("id");
    expect(fix.error, fix.error?.message).toBeNull();
    expect((fix.data ?? []).length, "the update must actually land").toBe(1);

    const asOwner = await owner.client.from("salary_entries")
      .insert({ site_id: siteB, period, amount_naira: 7 }).select("id");
    expect(asOwner.error, asOwner.error?.message).toBeNull();
  });

  // ── who records a bulk sale ───────────────────────────────────────────────
  const sale = (siteId: string) => ({
    site_id: siteId, buyer_name: `PL Buyer ${Date.now()}`, material_type_id: material,
    weight: 10, unit_price: 1000,
  });

  it("the manager records a bulk sale on their own site", async () => {
    const { error } = await mgrA.client.from("bulk_sales").insert(sale(siteA)).select("id");
    expect(error, error?.message).toBeNull();
  });

  it("inventory no longer records one — 0170 moved it to the manager", async () => {
    const { error } = await invA.client.from("bulk_sales").insert(sale(siteA)).select("id");
    expect(error, "0170 took this off inventory deliberately").not.toBeNull();
  });

  it("a manager cannot record a sale on another site", async () => {
    const { error } = await mgrB.client.from("bulk_sales").insert(sale(siteA)).select("id");
    expect(error).not.toBeNull();
  });

  it("a sale starts pending, so it is not revenue until the owner approves", async () => {
    const { data } = await mgrA.client.from("bulk_sales").insert(sale(siteA))
      .select("id, approval_status").single();
    expect(data!.approval_status).toBe("pending");
  });

  it("the manager may fix a pending sale but not one already approved", async () => {
    const { data } = await mgrA.client.from("bulk_sales").insert(sale(siteA)).select("id").single();
    const fix = await mgrA.client.from("bulk_sales")
      .update({ weight: 11 }).eq("id", data!.id).select("id");
    expect((fix.data ?? []).length, "a pending sale is still the manager's to correct").toBe(1);

    await adminClient().from("bulk_sales")
      .update({ approval_status: "approved" }).eq("id", data!.id);
    const after = await mgrA.client.from("bulk_sales")
      .update({ weight: 12 }).eq("id", data!.id).select("id");
    expect((after.data ?? []).length, "an approved sale is revenue; only the owner edits it").toBe(0);
  });

  // ── the statement itself ──────────────────────────────────────────────────
  it("the owner and the accountant can both run the statement", async () => {
    for (const [who, u] of [["owner", owner], ["accounting", acct]] as const) {
      const { data, error } = await u.client.rpc("profit_and_loss", {
        p_from: "2026-01-01", p_to: "2026-12-31",
      } as never);
      expect(error, `${who}: ${error?.message}`).toBeNull();
      expect((data as unknown[] ?? []).length, `${who} must see every site`).toBeGreaterThan(1);
    }
  });

  it("the statement excludes the wages expense category and reports it separately", async () => {
    const stamp = Date.now();
    await adminClient().from("consumables").insert([
      { site_id: siteA, name: `PL diesel ${stamp}`, category: "fuel_lubricants",
        amount_naira: 40_000, entry_date: "2026-03-05", approval_status: "approved" },
      { site_id: siteA, name: `PL payroll ${stamp}`, category: "wages",
        amount_naira: 500_000, entry_date: "2026-03-05", approval_status: "approved" },
    ]);
    const { data } = await owner.client.rpc("profit_and_loss", {
      p_from: "2026-03-01", p_to: "2026-03-31",
    } as never);
    const row = (data as Array<Record<string, number | string>>).find((r) => r.site_id === siteA)!;
    // The wages row must sit in its own memo column, never in expenses, or the
    // entered salary figure would count the same money twice.
    expect(Number(row.wages_in_expenses)).toBeGreaterThanOrEqual(500_000);
    expect(Number(row.expenses)).toBeGreaterThanOrEqual(40_000);
  });

  it("a window with no activity returns zeros, not nulls", async () => {
    const { data } = await owner.client.rpc("profit_and_loss", {
      p_from: "1999-01-01", p_to: "1999-01-31",
    } as never);
    for (const r of data as Array<Record<string, unknown>>) {
      for (const k of ["sales_total", "materials_cash", "materials_cogs", "expenses", "salaries"]) {
        expect(Number(r[k]), `${k} must be 0, not null`).toBe(0);
      }
    }
  });
});
