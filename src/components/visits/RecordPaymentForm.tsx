"use client";

import { useActionState } from "react";
import { recordSettlementPayment } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Record a part or full payment against an approved settlement. Cash is usually
// paid by the manager; transfers by the accountant. Amount defaults to the full
// remaining balance and is capped there.
export function RecordPaymentForm({
  visitId,
  settlementId,
  remaining,
}: {
  visitId: string;
  settlementId: string;
  remaining: number;
}) {
  const [state, action, pending] = useActionState(recordSettlementPayment, init);

  return (
    <form action={action} className="space-y-2 border-t border-line pt-3" data-confirm="Confirm this payment has actually been made to the supplier.">
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="settlement_id" value={settlementId} />
      <div className="text-xs font-medium text-ink-2">Record a payment · {ngn(remaining)} left to pay</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs font-medium">
          Amount (₦)
          <input
            type="number" name="amount" min="0.01" max={remaining} step="0.01" required
            defaultValue={remaining > 0 ? remaining : undefined}
            className="mt-1 block w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs font-medium">
          Method
          <select name="method" defaultValue="cash" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
            <option value="cash">Cash</option>
            <option value="transfer">Bank transfer</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs font-medium">
          Note (optional)
          <input type="text" name="note" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <button
        type="submit" disabled={pending}
        className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record payment"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">Payment recorded.</p>}
    </form>
  );
}
