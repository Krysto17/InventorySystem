"use client";

import { useActionState } from "react";
import { editConsumable } from "@/app/(inventory)/inventory/consumables/actions";
import { CONSUMABLE_CATEGORIES, CATEGORY_LABELS } from "@/app/(inventory)/inventory/consumables/categories";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Inline edit for an unpaid expense (manager/owner). Compact disclosure.
export function ConsumableEditForm({
  id, name, category, amount, comment, accountName, accountNumber, bankName,
}: {
  id: string; name: string; category: string; amount: number | null; comment: string | null;
  accountName: string | null; accountNumber: string | null; bankName: string | null;
}) {
  const [state, action, pending] = useActionState(editConsumable, init);
  return (
    <details>
      <summary className="cursor-pointer text-[10px] font-semibold text-ink-2 hover:underline">Edit</summary>
      <form action={action} className="mt-1 grid grid-cols-2 gap-2 rounded border border-line p-2 text-left">
        <input type="hidden" name="consumable_id" value={id} />
        <label className="text-xs col-span-2">Name
          <input type="text" name="name" required defaultValue={name} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">Category
          <select name="category" required defaultValue={category} className="mt-1 block w-full rounded border px-2 py-1 text-sm">
            {CONSUMABLE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="text-xs">Amount (₦)
          <input type="number" name="amount_naira" min="0.01" step="0.01" defaultValue={amount ?? undefined} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">Account name
          <input type="text" name="account_name" defaultValue={accountName ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs">Bank name
          <input type="text" name="bank_name" defaultValue={bankName ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs col-span-2">Account number <span className="font-normal text-gray-400">(10 digits)</span>
          <input type="text" name="account_number" inputMode="numeric" pattern="\d{10}" maxLength={10}
            defaultValue={accountNumber ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs col-span-2">Comment
          <input type="text" name="comment" defaultValue={comment ?? ""} className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
        {state.error && <p className="text-xs text-red-600 col-span-2">{state.error}</p>}
        {state.ok && <p className="text-xs text-green-700 col-span-2">Saved.</p>}
        <button type="submit" disabled={pending} className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white disabled:opacity-50 col-span-2">
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </details>
  );
}
