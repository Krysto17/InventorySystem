"use client";

import { useActionState } from "react";
import { holdPayable } from "@/app/payables/actions";
import type { ActionResult } from "@/lib/actions/result";

// Compact "Hold" button for a single payable (used on the accountant's payout
// rows). Pauses the payment so it drops off the queue until released.
export function HoldButton({ kind, id }: { kind: "settlement" | "advance" | "expense"; id: string }) {
  const [state, action, pending] = useActionState(holdPayable, { ok: false } as ActionResult);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending}
        className="rounded border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50 disabled:opacity-50">
        {pending ? "Holding…" : "Hold"}
      </button>
      {state.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
