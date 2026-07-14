"use client";

import { useActionState } from "react";
import { recordPriceCorrection } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Owner / general manager records a price correction on a paid visit.
export function PriceCorrectionForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(recordPriceCorrection, init);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium">
          The supplier was…
          <select name="direction" defaultValue="overpaid" className="mt-1 block rounded border px-2 py-1 text-sm">
            <option value="overpaid">Over-paid (owes money back)</option>
            <option value="underpaid">Under-paid (we owe them more)</option>
          </select>
        </label>
        <label className="text-xs font-medium">
          Difference (₦)
          <input type="number" name="amount" min="0.01" step="0.01" required className="mt-1 block w-36 rounded border px-2 py-1 text-sm" />
        </label>
        <label className="flex-1 text-xs font-medium">
          Reason
          <input type="text" name="reason" placeholder="e.g. grade re-checked, unit price wrong" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "Recording…" : "Record correction"}
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">Correction recorded.</p>}
    </form>
  );
}
