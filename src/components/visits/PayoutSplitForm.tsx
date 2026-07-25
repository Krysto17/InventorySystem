"use client";

import { useActionState } from "react";
import { AccountFields } from "@/components/accounts/AccountFields";
import type { KnownAccount } from "@/lib/accounts/known-accounts";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

// Manager adds one line of the payout plan: an exact amount into a named
// account. Repeat to split a payout across two or more accounts.
export function PayoutSplitForm({
  visitId, settlementId, unplanned, accounts, action,
}: {
  visitId: string; settlementId: string; unplanned: number; accounts: KnownAccount[]; action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, init);

  return (
    <form action={formAction} data-confirm="skip" className="mt-3 space-y-2 rounded border border-line p-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <input type="hidden" name="settlement_id" value={settlementId} />
      <div className="text-xs font-medium text-ink-2">Add a split · {ngn(unplanned)} still unallocated</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium">
          Amount to this account (₦)
          <input type="number" name="amount" min="0.01" max={unplanned} step="0.01" required
            defaultValue={unplanned > 0 ? unplanned : undefined}
            className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs font-medium">
          Note (optional)
          <input type="text" name="note" placeholder="e.g. partner's share"
            className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>
      <AccountFields accounts={accounts} label="Pay this portion into" />
      <button type="submit" disabled={pending}
        className="rounded border border-line px-3 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-50">
        {pending ? "Adding…" : "Add split"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && state.message && <p className="text-xs text-green-700">{state.message}</p>}
    </form>
  );
}
