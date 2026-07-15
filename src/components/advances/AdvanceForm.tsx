"use client";

import { useActionState } from "react";
import { recordAdvance } from "@/app/(manager)/manager/advances/actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Record-advance form. Account details (name / number / bank) must be entered
// together — the action + DB enforce it; this surfaces the error inline.
export function AdvanceForm({ suppliers }: { suppliers: { id: string; name: string; code: string | null }[] }) {
  const [state, action, pending] = useActionState(recordAdvance, init);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">Supplier
        <select name="supplier_id" required defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
          <option value="" disabled>Select supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code ?? "—"})</option>)}
        </select>
      </label>
      <label className="text-sm">Purpose
        <input type="text" name="purpose" required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">Amount (₦)
        <input type="number" name="amount_naira" min="1" step="0.01" required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">Account name <span className="font-normal text-gray-400">(where to pay)</span>
        <input type="text" name="account_name" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">Bank name
        <input type="text" name="bank_name" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm sm:col-span-2">Account number <span className="font-normal text-gray-400">(10 digits — required if paying to an account)</span>
        <input type="text" name="account_number" inputMode="numeric" pattern="\d{10}" maxLength={10}
          title="Exactly 10 digits (0-9)" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm sm:col-span-2">Comment
        <input type="text" name="comment" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      {state.error && <p className="text-xs text-red-600 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-xs text-green-700 sm:col-span-2">Advance recorded (pending owner approval).</p>}
      <button type="submit" disabled={pending}
        className="rounded bg-ore px-4 py-1.5 text-sm font-semibold text-white hover:bg-ore-strong disabled:opacity-50 sm:col-span-2">
        {pending ? "Recording…" : "Record advance (pending owner approval)"}
      </button>
    </form>
  );
}
