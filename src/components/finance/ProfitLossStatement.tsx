import { formatNaira } from "@/lib/visits/format";
import { linesFor, totalOf, type PlRow } from "@/lib/finance/profit-loss";

const ngn = (n: number) => formatNaira(n);

function Row({
  label, value, hint, strong, indent, sign,
}: {
  label: string; value: number; hint?: string;
  strong?: boolean; indent?: boolean; sign?: "plus" | "minus";
}) {
  return (
    <tr className={strong ? "border-t border-line font-semibold" : ""}>
      <td className={`py-1.5 pr-3 ${indent ? "pl-6" : ""}`}>
        {label}
        {hint ? <span className="block text-[11px] font-normal text-ink-2">{hint}</span> : null}
      </td>
      <td className="py-1.5 text-right tabular-nums">
        {sign === "minus" ? `(${ngn(value)})` : ngn(value)}
      </td>
    </tr>
  );
}

/**
 * The company's profit-and-loss for a window, laid out as a statement of
 * account: what came in, what went out, and what is left.
 *
 * Material cost is shown on TWO bases because they answer different questions
 * and the business asked for both — see lib/finance/profit-loss.ts. The
 * statement names both bottom lines rather than picking one, because picking
 * one silently would be the dishonest option: in a month of heavy buying the
 * cash figure is a loss while the trading figure is a profit, and both are
 * true.
 */
export function ProfitLossStatement({
  rows, from, to,
}: {
  rows: PlRow[]; from: string; to: string;
}) {
  const t = totalOf(rows);
  const l = linesFor(t);
  const unreceived = t.salesTotal - t.salesReceived;

  return (
    <div className="space-y-6">
      <section className="rounded border border-line">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold">Statement of profit or loss</h2>
          <p className="text-xs text-ink-2">
            {from} to {to} · all sites
          </p>
        </div>

        <div className="px-4 py-3">
          <table className="w-full text-sm">
            <tbody>
              <tr><td colSpan={2} className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Income</td></tr>
              <Row indent label="Material sold" value={t.salesTotal}
                hint="Bulk sales the owner has approved, at the agreed price" />
              <Row indent label="Processing fees and light bills collected" value={t.feesCollected}
                hint="Netted off a paid settlement, taken in cash, or recovered later" />
              <Row strong label="Total income" value={l.income} />

              <tr><td colSpan={2} className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Costs</td></tr>
              <Row indent sign="minus" label="Materials — paid to suppliers" value={t.materialsCash}
                hint="Money that actually left in this window (cash basis)" />
              <Row indent sign="minus" label="Materials — cost of what was sold" value={t.materialsCogs}
                hint="The sold weight at the weighted average cost of its lots" />
              <Row indent sign="minus" label="Expenses" value={t.expenses}
                hint="Approved expenses. Wages category excluded — see salaries" />
              <Row indent sign="minus" label="Salaries" value={t.salaries}
                hint="The payroll figure entered for each month in this window" />
              <Row indent sign="minus" label="Supplier compensations" value={t.corrections}
                hint="Under-priced supplies topped up after payment" />
            </tbody>
          </table>
        </div>

        {/* The two bottom lines, side by side, each saying what it means. */}
        <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
          <Bottom
            title="Profit / loss — cash basis"
            caption="Counts everything paid to suppliers in the window. Matches the bank; a month of heavy buying reads as a loss while the stock is still in the yard."
            cost={l.costCash}
            value={l.profitCash}
          />
          <Bottom
            title="Profit / loss — on material sold"
            caption="Counts only the cost of material that left. The figure to judge selling prices against; unsold stock stays as stock."
            cost={l.costOfSales}
            value={l.profitOfSales}
          />
        </div>
      </section>

      {(unreceived > 0.005 || t.wagesInExpenses > 0.005) && (
        <section className="rounded border border-ore/40 bg-ore/5 px-4 py-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ore">Worth knowing</h3>
          <ul className="mt-1 space-y-1 text-ink-2">
            {unreceived > 0.005 && (
              <li>
                <strong className="text-ink">{ngn(unreceived)}</strong> of the material sold has not
                been received yet. Income above is the agreed sale value, not cash in hand.
              </li>
            )}
            {t.wagesInExpenses > 0.005 && (
              <li>
                <strong className="text-ink">{ngn(t.wagesInExpenses)}</strong> sits in the{" "}
                <em>Wages</em> expense category and is <strong>not</strong> counted above. Salaries
                come from the figure entered for each month, so counting both would double it. Move
                those rows to another category, or fold them into the salary figure.
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Which site earned it. The owner's question after "did we make money". */}
      <section className="rounded border border-line">
        <div className="border-b border-line px-4 py-2">
          <h3 className="text-sm font-semibold">By site</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase text-ink-2">
                <th className="px-4 py-2">Site</th>
                <th className="px-4 py-2 text-right">Income</th>
                <th className="px-4 py-2 text-right">Costs (cash)</th>
                <th className="px-4 py-2 text-right">P/L cash</th>
                <th className="px-4 py-2 text-right">P/L on sales</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rl = linesFor(r);
                return (
                  <tr key={r.siteId} className="border-b border-line/60">
                    <td className="px-4 py-2 font-medium">{r.siteName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{ngn(rl.income)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{ngn(rl.costCash)}</td>
                    <td className={`px-4 py-2 text-right font-medium tabular-nums ${rl.profitCash < 0 ? "text-reject" : ""}`}>
                      {ngn(rl.profitCash)}
                    </td>
                    <td className={`px-4 py-2 text-right font-medium tabular-nums ${rl.profitOfSales < 0 ? "text-reject" : ""}`}>
                      {ngn(rl.profitOfSales)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="px-4 py-2">All sites</td>
                <td className="px-4 py-2 text-right tabular-nums">{ngn(l.income)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{ngn(l.costCash)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${l.profitCash < 0 ? "text-reject" : ""}`}>{ngn(l.profitCash)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${l.profitOfSales < 0 ? "text-reject" : ""}`}>{ngn(l.profitOfSales)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function Bottom({
  title, caption, cost, value,
}: { title: string; caption: string; cost: number; value: number }) {
  const loss = value < 0;
  return (
    <div className="bg-bg px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">{title}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${loss ? "text-reject" : "text-approve"}`}>
        {loss ? `Loss ${ngn(Math.abs(value))}` : ngn(value)}
      </p>
      <p className="text-[11px] text-ink-2">Against costs of {ngn(cost)}</p>
      <p className="mt-1 text-[11px] text-ink-2">{caption}</p>
    </div>
  );
}
