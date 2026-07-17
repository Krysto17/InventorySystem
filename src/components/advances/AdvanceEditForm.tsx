"use client";

import { useActionState } from "react";
import { editAdvance } from "@/app/(manager)/manager/advances/actions";
import { AccountFields } from "@/components/accounts/AccountFields";
import type { KnownAccount } from "@/lib/accounts/known-accounts";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Inline edit for an unpaid advance (manager/owner). Account details stay a
// complete set. Rendered inside a disclosure so the row stays compact.
export function AdvanceEditForm({
  id, purpose, amount, comment, accountName, accountNumber, bankName, accounts,
}: {
  id: string; purpose: string; amount: number; comment: string | null;
  accountName: string | null; accountNumber: string | null; bankName: string | null; accounts: KnownAccount[];
}) {
  const [state, action, pending] = useActionState(editAdvance, init);
  return (
    <details className="w-full">
      <summary className="cursor-pointer text-xs font-semibold text-ink-2 hover:underline">Edit</summary>
      <form action={action} className="mt-2 grid grid-cols-1 gap-2 rounded border border-line p-2 sm:grid-cols-2">
        <input type="hidden" name="advance_id" value={id} />
        <label className="text-xs">Purpose
          <input type="text" name="purpose" required defaultValue={purpose} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">Amount (₦)
          <input type="number" name="amount_naira" min="1" step="0.01" required defaultValue={amount} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <div className="sm:col-span-2">
          <AccountFields accounts={accounts} defaultName={accountName} defaultNumber={accountNumber} defaultBank={bankName} />
        </div>
        <label className="text-xs">Comment
          <input type="text" name="comment" defaultValue={comment ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        {state.error && <p className="text-xs text-red-600 sm:col-span-2">{state.error}</p>}
        {state.ok && <p className="text-xs text-green-700 sm:col-span-2">Saved.</p>}
        <button type="submit" disabled={pending} className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2">
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </details>
  );
}
