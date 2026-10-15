import { formatTimestamp } from "@/lib/visits/format";

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
  emptyText = "No payments recorded yet.",
}: {
  payments: PaymentRow[];
  emptyText?: string;
}) {
  if (payments.length === 0) {
    return <p className="px-3 py-2 text-xs text-ink-2">{emptyText}</p>;
  }

  const total = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="overflow-x-auto">
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
    </div>
  );
}
