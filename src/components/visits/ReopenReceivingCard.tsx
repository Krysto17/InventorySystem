"use client";

import { useActionState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { reopenReceiving } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// A batch already sent for analysis can be pulled back to receiving to add a
// missed material line or correct a weight, then submitted to QC again.
export function ReopenReceivingCard({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(reopenReceiving, init);
  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Add or correct a material line</h2></CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-ink-2">
          Missed a line, or need to fix a weight after submitting? Reopen the batch — it goes back
          to receiving so you can add or edit lines, then submit it to QC again for chemical analysis.
        </p>
        <form action={action} data-confirm="Reopen this batch for receiving? It leaves the QC queue until you submit it again.">
          <input type="hidden" name="visit_id" value={visitId} />
          <button type="submit" disabled={pending}
            className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-paper disabled:opacity-50">
            {pending ? "Reopening…" : "Reopen for receiving"}
          </button>
        </form>
        {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
        {state.ok && state.message && <p className="mt-1 text-xs text-green-700">{state.message}</p>}
      </CardContent>
    </Card>
  );
}
