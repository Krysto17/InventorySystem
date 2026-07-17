"use client";

import { useActionState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { reversePaidSupply } from "@/app/visits/[id]/finance-actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Accountant reverses a paid supply once a supplier refund is confirmed — the
// intake leaves stock, the settlement is voided, and the visit returns to
// pricing to be re-settled.
export function ReversePaidSupplyForm({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(reversePaidSupply, init);
  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Reverse paid supply (refund)</h2></CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-ink-2">
          Supplier refunded this paid supply to take the material back or re-settle? Reversing
          rolls the material out of stock, voids the payment, and returns the batch to pricing.
          Only possible while the material is still fully in stock.
        </p>
        <form action={action} data-confirm="Confirm the supplier has refunded this supply. It will be rolled out of stock and reopened at pricing." className="space-y-2">
          <input type="hidden" name="visit_id" value={visitId} />
          <textarea name="reason" required rows={2} placeholder="Refund confirmation / reason"
            className="block w-full rounded border px-2 py-1 text-sm" />
          <button type="submit" disabled={pending}
            className="rounded border border-reject px-3 py-1.5 text-sm font-semibold text-reject hover:bg-reject-soft disabled:opacity-50">
            {pending ? "Reversing…" : "Reverse paid supply"}
          </button>
          {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          {state.ok && <p className="text-xs text-green-700">Reversed — back to pricing for re-settlement.</p>}
        </form>
      </CardContent>
    </Card>
  );
}
