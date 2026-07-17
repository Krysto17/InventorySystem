"use client";

import { useActionState, useEffect, useRef } from "react";
import { editConsumable } from "@/app/(inventory)/inventory/consumables/actions";
import { CONSUMABLE_CATEGORIES, CATEGORY_LABELS } from "@/app/(inventory)/inventory/consumables/categories";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Edit an unpaid expense (manager/owner) in a roomy modal — the inline grid was
// unreadable crammed inside the table cell.
export function ConsumableEditForm({
  id, name, category, amount, comment, accountName, accountNumber, bankName,
}: {
  id: string; name: string; category: string; amount: number | null; comment: string | null;
  accountName: string | null; accountNumber: string | null; bankName: string | null;
}) {
  const [state, action, pending] = useActionState(editConsumable, init);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => { if (state.ok) ref.current?.close(); }, [state.ok]);

  const field = "mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm";

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()}
        className="rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-2 hover:bg-paper">
        Edit
      </button>
      <dialog ref={ref} className="w-[min(92vw,26rem)] rounded-lg border border-line p-0 text-ink backdrop:bg-black/40">
        <form action={action} data-confirm="skip" className="space-y-3 p-4 text-left">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Edit expense</h3>
            <button type="button" onClick={() => ref.current?.close()} className="text-lg leading-none text-ink-2 hover:text-ink">×</button>
          </div>
          <input type="hidden" name="consumable_id" value={id} />

          <label className="block text-xs font-medium">Name
            <input type="text" name="name" required defaultValue={name} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium">Category
              <select name="category" required defaultValue={category} className={field}>
                {CONSUMABLE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium">Amount (₦)
              <input type="number" name="amount_naira" min="0.01" step="0.01" defaultValue={amount ?? undefined} className={field} />
            </label>
          </div>

          <div className="border-t border-line pt-3 text-xs font-medium text-ink-2">Account details (pay to)</div>
          <label className="block text-xs font-medium">Account name
            <input type="text" name="account_name" defaultValue={accountName ?? ""} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium">Bank name
              <input type="text" name="bank_name" defaultValue={bankName ?? ""} className={field} />
            </label>
            <label className="block text-xs font-medium">Account number <span className="font-normal text-gray-400">(10 digits)</span>
              <input type="text" name="account_number" inputMode="numeric" pattern="\d{10}" maxLength={10} defaultValue={accountNumber ?? ""} className={field} />
            </label>
          </div>

          <label className="block text-xs font-medium">Comment
            <input type="text" name="comment" defaultValue={comment ?? ""} className={field} />
          </label>

          {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" onClick={() => ref.current?.close()} className="rounded border border-line px-3 py-1.5 text-sm hover:bg-paper">Cancel</button>
            <button type="submit" disabled={pending} className="rounded bg-ink px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
