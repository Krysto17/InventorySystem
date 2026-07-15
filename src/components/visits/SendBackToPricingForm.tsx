"use client";

import { useActionState } from "react";
import { sendBackToPricing } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Accounting sends a batch back to the manager to fix the pricing. A reason is
// required — it lands in the batch comment thread the manager reads.
export function SendBackToPricingForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(sendBackToPricing, init);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <p className="text-xs text-ink-2">
        Spotted a pricing error? Send the batch back to the manager to re-price. The
        approved settlement is voided and the batch re-runs through the owner&rsquo;s approval.
      </p>
      <label className="block text-xs font-medium">
        Reason for the manager
        <textarea
          name="reason"
          required
          rows={2}
          placeholder="e.g. Monazite priced at ₦900/kg — should be ₦1,200/kg"
          className="mt-1 block w-full rounded border px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? "Sending back…" : "Send back to manager"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">Sent back to the manager for correction.</p>}
    </form>
  );
}
