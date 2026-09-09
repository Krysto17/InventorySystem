"use client";

import { useActionState, useState } from "react";
import { addAdvanceShare, removeAdvanceShare } from "@/app/(manager)/manager/advances/actions";
import { SupplierPicker, type PickerSupplier } from "@/components/suppliers/SupplierPicker";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export type Share = { id: string; supplier: string; amount: number; note: string | null };

// Each share owns its own remove state, so one row's refusal cannot overwrite
// another row's — or the add form's. Removing a share moves that member's debt
// back to the collector; a refusal used to be a silent no-op, which is why the
// error is rendered right here on the row it belongs to.
function RemoveShare({ share, onAttempt }: { share: Share; onAttempt: () => void }) {
  const [state, action] = useActionState(removeAdvanceShare, init);
  return (
    <form
      action={action}
      onSubmit={onAttempt}
      data-confirm="Remove this share? The debt returns to the collector."
      className="text-right"
    >
      <input type="hidden" name="share_id" value={share.id} />
      <SubmitButton pendingText="…" className="rounded border border-reject px-1.5 text-[11px] leading-5 text-reject hover:bg-reject-soft disabled:opacity-50">✕</SubmitButton>
      {state.error && <p role="alert" className="mt-0.5 text-[11px] text-red-600">{state.error}</p>}
    </form>
  );
}

// One customer collected this advance for a group. Apportion the DEBT: each
// share moves onto that supplier's balance; the collector keeps the remainder.
export function AdvanceShares({
  advanceId, amount, collector, shares, suppliers, canEdit,
}: {
  advanceId: string; amount: number; collector: string;
  shares: Share[]; suppliers: PickerSupplier[]; canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(addAdvanceShare, init);
  // "Share added" belongs to the ADD form. Once a removal has been attempted it
  // is stale, and leaving it on screen next to a refused removal reads as though
  // the removal was what succeeded — so it is retired on the first remove.
  // The add's own state is untouched: only whether the message is shown.
  const [removed, setRemoved] = useState(false);

  const shared = shares.reduce((s, r) => s + r.amount, 0);
  const remainder = amount - shared;
  if (!canEdit && shares.length === 0) return null;

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-xs font-semibold text-ink-2 hover:underline">
        Shared debt{shares.length > 0 ? ` · ${shares.length} other supplier${shares.length === 1 ? "" : "s"}` : ""}
      </summary>
      <div className="mt-2 space-y-2 rounded border border-line p-2">
        <p className="text-[11px] text-ink-2">
          Collected by <strong>{collector}</strong>. Give each member their share — it moves onto
          their own debt balance and is recovered from their own supplies. {collector} keeps whatever
          isn&rsquo;t shared.
        </p>

        <ul className="divide-y divide-line text-xs">
          {shares.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-1">
              <span>{r.supplier}{r.note ? <span className="text-ink-2"> · {r.note}</span> : null}</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold">{ngn(r.amount)}</span>
                {canEdit && <RemoveShare share={r} onAttempt={() => setRemoved(true)} />}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between py-1 font-semibold">
            <span>{collector} (remainder)</span>
            <span>{ngn(remainder)}</span>
          </li>
        </ul>

        {canEdit && remainder > 0.005 && (
          <form action={action} data-confirm="skip" className="space-y-2 border-t border-line pt-2">
            <input type="hidden" name="advance_id" value={advanceId} />
            <SupplierPicker suppliers={suppliers} label="Who else owes part of this?" />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium">
                Their share (₦)
                <input type="number" name="amount" min="0.01" max={remainder} step="0.01" required
                  className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
              <label className="text-xs font-medium">
                Note (optional)
                <input type="text" name="note" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
            </div>
            <SubmitButton pendingText="Adding…" className="rounded border border-line px-3 py-1 text-xs font-semibold hover:bg-paper disabled:opacity-50">
              Add share ({ngn(remainder)} left)
            </SubmitButton>
            {state.error && <p className="text-xs text-red-600">{state.error}</p>}
            {state.ok && state.message && !removed && <p className="text-xs text-green-700">{state.message}</p>}
            {pending && null}
          </form>
        )}
      </div>
    </details>
  );
}
