"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/actions/result";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

// Owner hold / release button for an approved batch settlement. Shows a real
// error (including the RLS/trigger 0-row case) rather than looking dead.
export function HoldReleaseButton({
  action,
  id,
  label,
  variant,
}: {
  action: Action;
  id: string;
  label: string;
  variant: "hold" | "release";
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const cls =
    variant === "hold"
      ? "rounded border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50 disabled:opacity-50"
      : "rounded bg-approve px-3 py-1 text-xs font-semibold text-white disabled:opacity-50";
  return (
    <form action={formAction}>
      <input type="hidden" name="settlement_id" value={id} />
      <button type="submit" disabled={pending} className={cls}>
        {pending ? "Working…" : label}
      </button>
      {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
