"use client";

import { useActionState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { closeDressingOnly } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Shown after processing (in_receiving / pricing) when the customer only dressed
// their material for the light bill and isn't supplying. Two outcomes: carry the
// light bill to their account, or confirm they paid it in cash.
export function DressingOnlyClose({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(closeDressingOnly, init);
  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Dressing only — no supply</h2></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-ink-2">
          Customer dressed their material for the light bill but isn&rsquo;t supplying here? Close the
          visit — either carry the light bill to their account (to recover later) or confirm they
          paid it in cash.
        </p>
        <form action={action} data-confirm="skip" className="flex flex-wrap gap-2">
          <input type="hidden" name="visit_id" value={visitId} />
          <button type="submit" name="carry" value="0" disabled={pending}
            onClick={(e) => { if (!window.confirm("Close as dressing-only — customer PAID the light bill in cash?")) e.preventDefault(); }}
            className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Closing…" : "Paid in cash"}
          </button>
          <button type="submit" name="carry" value="1" disabled={pending}
            onClick={(e) => { if (!window.confirm("Close as dressing-only — carry the light bill to the customer's account (they owe it)?")) e.preventDefault(); }}
            className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-paper disabled:opacity-50">
            {pending ? "Closing…" : "Carry to account"}
          </button>
        </form>
        {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
        {state.ok && <p className="mt-1 text-xs text-green-700">Visit closed.</p>}
      </CardContent>
    </Card>
  );
}
