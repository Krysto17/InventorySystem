import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { ProfitLossPdf } from "@/lib/pdf/templates/profit-loss";
import type { PlRow } from "@/lib/finance/profit-loss";

// A react-pdf template fails at RENDER time, not compile time, so the only way
// to know the statement downloads is to render one.
const rows: PlRow[] = [
  { siteId: "a", siteName: "Dong", salesTotal: 450_000, salesReceived: 400_000,
    feesCollected: 20_000, materialsCash: 1_000_000, materialsCogs: 300_000,
    expenses: 50_000, wagesInExpenses: 500_000, salaries: 2_400_000, corrections: 0 },
  { siteId: "b", siteName: "New-Site", salesTotal: 0, salesReceived: 0,
    feesCollected: 0, materialsCash: 0, materialsCogs: 0,
    expenses: 0, wagesInExpenses: 0, salaries: 0, corrections: 0 },
];

const render = (r: PlRow[]) =>
  renderToBuffer(React.createElement(ProfitLossPdf, {
    rows: r, from: "2026-10-01", to: "2026-10-31", docId: "TESTDOC000000001",
  }) as unknown as React.ReactElement<DocumentProps>);

describe("profit & loss PDF", () => {
  it("renders a real PDF", async () => {
    const buf = await render(rows);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("renders with no activity at all, rather than throwing", async () => {
    const buf = await render([rows[1]]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);

  it("renders when there are no sites", async () => {
    const buf = await render([]);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
});
