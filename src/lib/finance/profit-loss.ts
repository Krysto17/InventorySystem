import { createClient } from "@/lib/supabase/server";

// ─── The profit & loss statement ────────────────────────────────────────────
// 0170 put the components in one SQL function, one row per site. This module
// turns them into the two bottom lines and nothing else, so every screen and
// the PDF quote the same arithmetic.
//
//   income        = material sold + processing fees collected
//   cost (cash)   = paid to suppliers + expenses + salaries + corrections
//   cost (of sale)= cost of material sold + expenses + salaries + corrections
//
// Material cost appears twice ON PURPOSE, because the two answer different
// questions and the business asked for both:
//
//   CASH BASIS       matches the bank. Buy 100kg and sell 30kg and the whole
//                    purchase is a cost, so a month of heavy buying reads as a
//                    loss while the stock still sits in the yard.
//   COST OF SALES    charges only the 30kg that left, valued at the weighted
//                    average cost of that material's lots. Truer trading
//                    profit, and the figure to judge a price against.
//
// Neither is "the" answer, which is why the statement shows both and says so.

export type PlRow = {
  siteId: string;
  siteName: string;
  salesTotal: number;      // income — approved bulk sales at sale value
  salesReceived: number;   // memo   — how much of that has actually come in
  feesCollected: number;   // income — processing fees / light bills collected
  materialsCash: number;   // cost   — money paid to suppliers in the window
  materialsCogs: number;   // cost   — weighted-average cost of material sold
  expenses: number;        // cost   — approved expenses, excluding wages
  wagesInExpenses: number; // memo   — wages-category rows deliberately excluded
  salaries: number;        // cost   — the entered payroll figure
  corrections: number;     // cost   — under-priced supplies compensated
};

export type PlLines = {
  income: number;
  costCash: number;
  costOfSales: number;
  profitCash: number;
  profitOfSales: number;
};

const n = (v: unknown) => Number(v ?? 0);

/** The two bottom lines for one row, or for a total. */
export function linesFor(r: Omit<PlRow, "siteId" | "siteName">): PlLines {
  const income = r.salesTotal + r.feesCollected;
  const shared = r.expenses + r.salaries + r.corrections;
  const costCash = r.materialsCash + shared;
  const costOfSales = r.materialsCogs + shared;
  return {
    income,
    costCash,
    costOfSales,
    profitCash: income - costCash,
    profitOfSales: income - costOfSales,
  };
}

const ZERO = {
  salesTotal: 0, salesReceived: 0, feesCollected: 0, materialsCash: 0,
  materialsCogs: 0, expenses: 0, wagesInExpenses: 0, salaries: 0, corrections: 0,
};

/** Sum the per-site rows into a company total. */
export function totalOf(rows: PlRow[]): Omit<PlRow, "siteId" | "siteName"> {
  return rows.reduce((t, r) => ({
    salesTotal: t.salesTotal + r.salesTotal,
    salesReceived: t.salesReceived + r.salesReceived,
    feesCollected: t.feesCollected + r.feesCollected,
    materialsCash: t.materialsCash + r.materialsCash,
    materialsCogs: t.materialsCogs + r.materialsCogs,
    expenses: t.expenses + r.expenses,
    wagesInExpenses: t.wagesInExpenses + r.wagesInExpenses,
    salaries: t.salaries + r.salaries,
    corrections: t.corrections + r.corrections,
  }), { ...ZERO });
}

/**
 * Every component of the statement for the window, per site.
 *
 * RLS scopes it: the owner and the (cross-site) accountant get all three sites,
 * and a site-scoped role would get only its own. PostgREST returns numerics as
 * strings, so every field is coerced here rather than at each call site.
 */
export async function fetchProfitLoss(from: string, to: string): Promise<PlRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("profit_and_loss", {
    p_from: from, p_to: to,
  } as never);
  if (error) throw new Error(`Could not build the statement: ${error.message}`);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    siteId: String(r.site_id),
    siteName: String(r.site_name ?? "—"),
    salesTotal: n(r.sales_total),
    salesReceived: n(r.sales_received),
    feesCollected: n(r.fees_collected),
    materialsCash: n(r.materials_cash),
    materialsCogs: n(r.materials_cogs),
    expenses: n(r.expenses),
    wagesInExpenses: n(r.wages_in_expenses),
    salaries: n(r.salaries),
    corrections: n(r.corrections),
  }));
}

/** First day of the current month, as the statement's default start. */
export function defaultFrom(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}
