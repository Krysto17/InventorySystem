"use client";

import { useActionState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { closeDressingOnly } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Shown after processing (in_receiving / pricing) when the customer only dressed
// their material for the light bill and isn't supplying. Carries the light bill
// to their account and closes the visit.
export function DressingOnlyClose({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(closeDressingOnly, init);
  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Dressing only — no supply</h2></CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-ink-2">
          Customer dressed their material for the light bill but isn&rsquo;t supplying here? Close the
          visit — the light bill is carried to their account, to recover from a later supply (any
          site) or collect in cash.
        </p>
        <form action={action} data-confirm="Close this visit as dressing-only? The light bill is carried to the customer's account and the visit is closed.">
          <input type="hidden" name="visit_id" value={visitId} />
          <button type="submit" disabled={pending}
            className="rounded border border-reject px-3 py-1.5 text-sm font-semibold text-reject hover:bg-reject-soft disabled:opacity-50">
            {pending ? "Closing…" : "Close as dressing-only"}
          </button>
        </form>
        {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
        {state.ok && <p className="mt-1 text-xs text-green-700">Closed — light bill carried to the customer&rsquo;s account.</p>}
      </CardContent>
    </Card>
  );
}
