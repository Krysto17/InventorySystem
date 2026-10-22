import { describe, it, expect } from "vitest";
import { linesFor, totalOf, type PlRow } from "@/lib/finance/profit-loss";

const row = (over: Partial<PlRow> = {}): PlRow => ({
  siteId: "s1", siteName: "Dong",
  salesTotal: 0, salesReceived: 0, feesCollected: 0, materialsCash: 0,
  materialsCogs: 0, expenses: 0, wagesInExpenses: 0, salaries: 0, corrections: 0,
  ...over,
});

describe("profit & loss arithmetic", () => {
  // The worked example behind the design decision: buy 100kg for 1m, sell 30kg
  // of it for 450k. Cash basis says loss, cost-of-sales says profit, and both
  // are true — which is why the statement prints both.
  it("reports a loss on cash basis and a profit on cost of sales", () => {
    const l = linesFor(row({
      salesTotal: 450_000,
      materialsCash: 1_000_000,   // all 100kg paid for
      materialsCogs: 300_000,     // only the 30kg that left
    }));
    expect(l.income).toBe(450_000);
    expect(l.profitCash).toBe(-550_000);
    expect(l.profitOfSales).toBe(150_000);
  });

  it("counts fees as income, not as a cost", () => {
    // Light bills are billed TO the client, so they are revenue. Putting them
    // on the cost side would swing the statement by twice their value.
    const l = linesFor(row({ feesCollected: 80_000 }));
    expect(l.income).toBe(80_000);
    expect(l.profitCash).toBe(80_000);
  });

  it("charges expenses, salaries and compensations against both bases", () => {
    const l = linesFor(row({
      salesTotal: 1_000_000, materialsCash: 100_000, materialsCogs: 60_000,
      expenses: 50_000, salaries: 200_000, corrections: 10_000,
    }));
    const shared = 50_000 + 200_000 + 10_000;
    expect(l.costCash).toBe(100_000 + shared);
    expect(l.costOfSales).toBe(60_000 + shared);
    expect(l.profitCash).toBe(1_000_000 - (100_000 + shared));
    expect(l.profitOfSales).toBe(1_000_000 - (60_000 + shared));
  });

  it("never counts the wages memo as a cost", () => {
    // wagesInExpenses exists only to warn that money is sitting in the wrong
    // category. If it ever reached a total it would double the payroll.
    const withWages = linesFor(row({ salaries: 100, wagesInExpenses: 999_999 }));
    const without = linesFor(row({ salaries: 100 }));
    expect(withWages.costCash).toBe(without.costCash);
    expect(withWages.profitCash).toBe(without.profitCash);
  });

  it("totals the sites, and the total's bottom line equals the sum of theirs", () => {
    const rows = [
      row({ siteId: "a", salesTotal: 100, materialsCash: 40, materialsCogs: 10, expenses: 5 }),
      row({ siteId: "b", salesTotal: 200, materialsCash: 50, materialsCogs: 20, salaries: 7 }),
    ];
    const t = totalOf(rows);
    expect(t.salesTotal).toBe(300);
    expect(t.materialsCash).toBe(90);
    const combined = linesFor(t);
    const perSite = rows.reduce((s, r) => s + linesFor(r).profitCash, 0);
    expect(combined.profitCash).toBe(perSite);
  });

  it("an empty period is zero, not NaN", () => {
    const t = totalOf([]);
    const l = linesFor(t);
    for (const v of [l.income, l.costCash, l.costOfSales, l.profitCash, l.profitOfSales]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });
});
