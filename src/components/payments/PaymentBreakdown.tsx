import { formatTimestamp } from "@/lib/visits/format";

/** One line of the manager's payout plan: an account and what it was to receive. */
export type PlanRow = {
  id: string;
  amount: number;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
  note?: string | null;
};

export type PaymentRow = {
  id: string;
  amount: number;
  method: string | null;
  note: string | null;
  created_at: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
  payer_name?: string | null;
};

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", transfer: "Transfer", other: "Other",
};

/**
 * Where a payout actually went.
 *
 * A supplier settlement can be paid in several parts, each into a different
 * account — part by transfer to the supplier's bank, part in cash from the
 * safe, part to whoever the supplier nominated. The payables screens showed
 * only the total paid, which answers "is it settled?" but not "who received
 * it?", and that second question is the one the manager, the accountant and
 * the owner have to answer when a supplier disputes a payment.
 *
 * Each payment row carries its own account, so the breakdown is simply those
 * rows, in the order they were made, with the destination spelled out.
 */
export function PaymentBreakdown({
  payments,
  plan = [],
  emptyText = "No payments recorded yet.",
}: {
  payments: PaymentRow[];
  /**
   * The manager's payout plan, shown only when the ledger has fewer rows than
   * the plan had accounts.
   *
   * Until this was fixed, closing a settlement recorded ONE payment for the
   * whole balance even when the payout had been split three ways, so for those
   * settlements the accounts are simply not in the payment ledger and cannot be
   * put there after the fact. The plan is the only surviving record of where the
   * money was meant to go, so it is shown — labelled as the plan, never as
   * recorded payments, because the two are not the same claim.
   */
  plan?: PlanRow[];
  emptyText?: string;
}) {
  const showPlan = plan.length > 0 && payments.length < plan.length;

  if (payments.length === 0 && !showPlan) {
    return <p className="px-3 py-2 text-xs text-ink-2">{emptyText}</p>;
  }

  const total = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="overflow-x-auto">
      {payments.length > 0 && (
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase text-ink-2">
            <th className="px-3 py-1.5">Paid into</th>
            <th className="px-3 py-1.5">How</th>
            <th className="px-3 py-1.5">By / when</th>
            <th className="px-3 py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const named = p.account_name || p.account_number || p.bank_name;
            return (
              <tr key={p.id} className="border-b border-line/60">
                <td className="px-3 py-1.5">
                  {named ? (
                    <>
                      <span className="font-medium">{p.account_name ?? "—"}</span>
                      <span className="text-ink-2">
                        {p.bank_name ? ` · ${p.bank_name}` : ""}
                        {p.account_number ? ` · ${p.account_number}` : ""}
                      </span>
                    </>
                  ) : (
                    // Cash out of the safe has no account; saying so is clearer
                    // than an empty cell that reads like missing data.
                    <span className="text-ink-2">
                      {p.method === "cash" ? "Cash — no account" : "Account not recorded"}
                    </span>
                  )}
                  {p.note ? <span className="block text-ink-2">{p.note}</span> : null}
                </td>
                <td className="px-3 py-1.5 text-ink-2">
                  {p.method ? METHOD_LABEL[p.method] ?? p.method : "—"}
                </td>
                <td className="px-3 py-1.5 text-ink-2">
                  {p.payer_name ?? "—"}
                  {p.created_at ? ` · ${formatTimestamp(p.created_at)}` : ""}
                </td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{ngn(Number(p.amount))}</td>
              </tr>
            );
          })}
        </tbody>
        {payments.length > 1 && (
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <td className="px-3 py-1.5" colSpan={3}>
                Total across {payments.length} payments
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{ngn(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      )}

      {showPlan && (
        <div className="border-t border-line bg-amber-50/60 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase text-ore">
            Manager&rsquo;s payout plan — {plan.length} accounts
          </p>
          <p className="mb-1 text-[11px] text-ink-2">
            This payout was closed before split payments were recorded account by
            account, so the ledger above has only {payments.length === 1 ? "one row" : `${payments.length} rows`}.
            These are the accounts the split was planned against.
          </p>
          <ul className="space-y-0.5">
            {plan.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 text-xs">
                <span>
                  <span className="font-medium">{r.account_name ?? "—"}</span>
                  <span className="text-ink-2">
                    {r.bank_name ? ` · ${r.bank_name}` : ""}
                    {r.account_number ? ` · ${r.account_number}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </span>
                <span className="font-medium tabular-nums">{ngn(Number(r.amount))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
