"use client";

import { useActionState } from "react";
import { recordOverpayment } from "@/app/suppliers/actions";
import type { SupplierEditState } from "@/app/suppliers/actions";

const init: SupplierEditState = {};

// Record an overpayment (supply / expense / advance overpaid to this supplier)
// as a debt tagged "Overpayment" — it's added to the outstanding balance and
// recovered from a later supply or repaid in cash.
export function OverpaymentForm({ supplierId }: { supplierId: string }) {
  const [state, action, pending] = useActionState(recordOverpayment, init);
  return (
    <form action={action} data-confirm="Record this overpayment as a debt the supplier owes back?" className="space-y-2 border-t border-line pt-3">
      <p className="text-xs text-gray-500">
        Overpaid this supplier (a supply, expense, or advance)? Record it here — it becomes an
        outstanding debt tagged <strong>Overpayment</strong> that recovers from their next supply
        or a cash repayment.
      </p>
      <input type="hidden" name="supplier_id" value={supplierId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs font-medium">Amount overpaid (₦)
          <input type="number" name="amount" min="0.01" step="0.01" required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs font-medium">Overpaid on
          <select name="source" required defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
            <option value="" disabled>Select…</option>
            <option value="supply">Supply</option>
            <option value="expense">Expense</option>
            <option value="advance">Advance</option>
          </select>
        </label>
        <label className="text-xs font-medium">Note (optional)
          <input type="text" name="note" placeholder="e.g. visit ref / reason" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <button type="submit" disabled={pending} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Recording…" : "Record overpayment"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">{state.ok}</p>}
    </form>
  );
}
