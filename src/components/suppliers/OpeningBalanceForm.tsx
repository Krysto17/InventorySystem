"use client";

import { useActionState } from "react";
import { recordOpeningBalance, type SupplierEditState } from "@/app/suppliers/actions";

const init: SupplierEditState = {};
const ngn = (n: number) => `₦${n.toLocaleString()}`;

// Owner-only: record a supplier's pre-software debt as an opening balance. Once
// recorded it becomes outstanding debt and future payouts deduct against it.
export function OpeningBalanceForm({
  supplierId,
  outstandingDebt,
  hasOpeningBalance,
}: {
  supplierId: string;
  outstandingDebt: number;
  hasOpeningBalance: boolean;
}) {
  const [state, action, pending] = useActionState(recordOpeningBalance, init);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="text-sm">
        Current outstanding debt: <strong>{ngn(outstandingDebt)}</strong>
      </div>

      {hasOpeningBalance ? (
        <p className="text-xs text-gray-500">
          An opening balance has already been recorded for this supplier. Adjustments beyond
          this should go through normal advances / deductions.
        </p>
      ) : (
        <form action={action} className="space-y-2">
          <input type="hidden" name="supplier_id" value={supplierId} />
          <p className="text-xs text-gray-500">
            Enter what this supplier owed <em>before</em> you started using the app. It&rsquo;s
            recorded as already-paid debt (so it never appears in the payout queue) and future
            supplies will deduct against it.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium">
              Amount owed (₦)
              <input
                type="number"
                name="amount"
                min="1"
                step="0.01"
                required
                className="mt-1 block w-full rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs font-medium">
              As of date
              <input
                type="date"
                name="as_of"
                defaultValue={today}
                className="mt-1 block w-full rounded border px-2 py-1 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Recording…" : "Record opening balance"}
          </button>
          {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          {state.ok && <p className="text-xs text-green-700">{state.ok}</p>}
        </form>
      )}
    </div>
  );
}
