"use client";

import { useActionState } from "react";
import { useCommandId } from "@/components/ui/use-command-id";
import type { ActionResult } from "@/lib/actions/result";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

// Mark-paid button that shows a real error (including the RLS 0-row case) rather
// than looking dead when the write is denied.
export function MarkPaidButton({
  action,
  inputName,
  id,
  label = "Mark paid",
}: {
  action: Action;
  inputName: string;
  id: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  // 0163: this form pays money, so it must say which command it is. Without the
  // id the payment action cannot tell a retry from a second payout and refuses.
  const submit = useCommandId(state)(formAction);
  return (
    <form action={submit} className="mt-2" data-confirm="Confirm you have already paid this. It will be recorded as paid.">
      <input type="hidden" name={inputName} value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Paying…" : label}
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
