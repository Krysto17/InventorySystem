"use client";

import { useActionState } from "react";
import { sendBackToOwner } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Accounting returns a batch to the owner for review. A reason is required — it
// lands in the batch comment thread the owner reads. The owner then re-approves
// or sends it on to the manager to re-price.
export function SendBackToOwnerForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(sendBackToOwner, init);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <p className="text-xs text-ink-2">
        Spotted a pricing error? Return the batch to the owner to review. The approved
        settlement is voided; the owner then re-approves it or sends it to the manager to
        re-price.
      </p>
      <label className="block text-xs font-medium">
        Reason for the owner
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="e.g. Monazite priced at ₦900/kg — looks too low, please review"
          className="mt-1 block w-full rounded border px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "Returning…" : "Send back to owner"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">Returned to the owner for review.</p>}
    </form>
  );
}
