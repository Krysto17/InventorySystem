"use client";

import { useActionState } from "react";
import { closeSettlement } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Marks a fully-covered (₦0 remaining) settlement paid — no amount to record.
export function CloseSettlementButton({ visitId, settlementId }: { visitId: string; settlementId: string }) {
  const [state, action, pending] = useActionState(closeSettlement, init);
  return (
    <form action={action}>
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="settlement_id" value={settlementId} />
      <button type="submit" disabled={pending}
        onClick={(e) => { if (!window.confirm("Nothing is owed on this batch (₦0). Mark it paid and close it?")) e.preventDefault(); }}
        className="rounded bg-ink px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
        {pending ? "Closing…" : "Mark paid (₦0)"}
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
