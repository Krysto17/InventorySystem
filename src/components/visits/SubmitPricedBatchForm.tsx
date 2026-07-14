"use client";

import { submitPricedBatch } from "@/app/visits/[id]/batch-actions";
import { SubmitButton } from "@/components/ui/SubmitButton";

// Manager submits the priced batch to the owner for approval. Rendered directly
// below the batch supply settlement so the manager reviews the net payable, then
// submits.
export function SubmitPricedBatchForm({ visitId }: { visitId: string }) {
  return (
    <form action={submitPricedBatch} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <label className="text-xs font-medium">
        Payment terms
        <select name="payment_terms" defaultValue="immediate" className="mt-1 block rounded border px-2 py-1 text-sm">
          <option value="immediate">Immediate</option>
          <option value="deferred">Deferred (pay later)</option>
          <option value="installment">Installments</option>
          <option value="deducted">Deduct from processing fee</option>
        </select>
      </label>
      <SubmitButton pendingText="Submitting…" className="rounded bg-ore px-3 py-2 text-sm font-semibold text-white hover:bg-ore-strong disabled:opacity-50">
        Submit priced batch to owner →
      </SubmitButton>
    </form>
  );
}
