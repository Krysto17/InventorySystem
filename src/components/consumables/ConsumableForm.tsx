"use client";

import { useActionState } from "react";
import { createConsumable } from "@/app/(inventory)/inventory/consumables/actions";
import { CONSUMABLE_CATEGORIES, CATEGORY_LABELS } from "@/app/(inventory)/inventory/consumables/categories";
import { AccountFields } from "@/components/accounts/AccountFields";
import type { KnownAccount } from "@/lib/accounts/known-accounts";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Log-an-expense form. Account details (name / number / bank) are entered as a
// complete set with autofill — enforced by the action and the DB.
export function ConsumableForm({ today, accounts }: { today: string; accounts: KnownAccount[] }) {
  const [state, action, pending] = useActionState(createConsumable, init);
  return (
    <form action={action} className="space-y-3 max-w-md">
      <label className="block text-sm font-medium">Name *
        <input type="text" name="name" required placeholder="e.g. Diesel, Generator repair, Office paper"
          className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Category *
          <select name="category" required defaultValue="" className="mt-1 block w-full border rounded px-2 py-1 text-sm">
            <option value="" disabled>Select…</option>
            {CONSUMABLE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">Date
          <input type="date" name="entry_date" defaultValue={today} className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
        </label>
      </div>
      <label className="block text-sm font-medium">Amount (₦, optional)
        <input type="number" name="amount_naira" min="0.01" step="0.01" className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
      </label>
      <AccountFields accounts={accounts} label="Account details (where to pay — optional)" />
      <label className="block text-sm font-medium">Comment
        <textarea name="comment" rows={2} placeholder="Optional note" className="mt-1 block w-full border rounded px-2 py-1 text-sm" />
      </label>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700">Expense logged.</p>}
      <button type="submit" disabled={pending} className="px-4 py-2 bg-black text-white text-sm rounded disabled:opacity-50">
        {pending ? "Logging…" : "Log"}
      </button>
    </form>
  );
}
