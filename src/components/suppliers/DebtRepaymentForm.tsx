"use client";

import { useActionState, useState } from "react";
import { recordDebtRepayment } from "@/app/suppliers/actions";
import type { SupplierEditState } from "@/app/suppliers/actions";

const init: SupplierEditState = {};
const ngn = (n: number) => `₦${n.toLocaleString()}`;

// Record a repayment the supplier made outside the app (bank transfer / cash).
// The two balances are separate: ADVANCE debt (cash floats) and PROCESSING debt
// (carried light bills), so the repayment is applied to whichever is chosen.
export function DebtRepaymentForm({
  supplierId,
  outstandingDebt,
  processingDebt = 0,
}: {
  supplierId: string;
  outstandingDebt: number;
  processingDebt?: number;
}) {
  const [state, action, pending] = useActionState(recordDebtRepayment, init);
  const [kind, setKind] = useState<"advance" | "processing">(
    outstandingDebt > 0 ? "advance" : "processing",
  );

  if (outstandingDebt <= 0 && processingDebt <= 0) return null;
  const max = kind === "processing" ? processingDebt : outstandingDebt;

  return (
    <form action={action} className="space-y-2 border-t border-line pt-3">
      <p className="text-xs text-gray-500">
        Supplier repaid outside the app (bank transfer / cash)? Record it here and it comes off
        that balance. You can&rsquo;t repay more than the {ngn(max)} owed on the selected debt.
      </p>
      <input type="hidden" name="supplier_id" value={supplierId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs font-medium">
          Repay which debt
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "advance" | "processing")}
            className="mt-1 block w-full rounded border px-2 py-1 text-sm"
          >
            <option value="advance" disabled={outstandingDebt <= 0}>
              Advance debt ({ngn(outstandingDebt)})
            </option>
            <option value="processing" disabled={processingDebt <= 0}>
              Processing / light bill ({ngn(processingDebt)})
            </option>
          </select>
        </label>
        <label className="text-xs font-medium">
          Amount repaid (₦)
          <input type="number" name="amount" min="0.01" max={max} step="0.01" required
            className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs font-medium">
          Note (optional)
          <input type="text" name="note" placeholder="e.g. Bank transfer 12 Jul"
            className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <button type="submit" disabled={pending}
        className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Recording…" : "Record repayment"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">{state.ok}</p>}
    </form>
  );
}
