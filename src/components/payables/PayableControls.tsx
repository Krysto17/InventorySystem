"use client";

import { useActionState } from "react";
import { holdPayable, releasePayable, sendPayableBack } from "@/app/payables/actions";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Hold / release / send-back controls for one payable. Shown to the reviewer
// (owner / manager / accountant). `status` decides which primary action shows;
// send-back (with a required reason) is always available on an unpaid item.
export function PayableControls({
  kind,
  id,
  status,
}: {
  kind: "settlement" | "advance" | "expense";
  id: string;
  status: "approved" | "on_hold";
}) {
  const [holdState, holdAction, holding] = useActionState(holdPayable, init);
  const [relState, relAction, releasing] = useActionState(releasePayable, init);
  const [sbState, sbAction, sending] = useActionState(sendPayableBack, init);
  const err = holdState.error || relState.error || sbState.error;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {status === "approved" ? (
          <form action={holdAction}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <button type="submit" disabled={holding}
              className="rounded border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50 disabled:opacity-50">
              {holding ? "Holding…" : "Hold"}
            </button>
          </form>
        ) : (
          <form action={relAction}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <button type="submit" disabled={releasing}
              className="rounded bg-approve px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
              {releasing ? "Releasing…" : "Release"}
            </button>
          </form>
        )}
        <details className="group relative">
          <summary className="cursor-pointer list-none rounded border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50">
            Send back
          </summary>
          <form action={sbAction} className="absolute right-0 z-10 mt-1 w-64 space-y-2 rounded border border-line bg-paper p-2 shadow-lg">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <textarea name="reason" required rows={2} placeholder="Reason for the manager"
              className="block w-full rounded border px-2 py-1 text-xs" />
            <button type="submit" disabled={sending}
              className="w-full rounded bg-ink px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
              {sending ? "Sending…" : "Send back to manager"}
            </button>
          </form>
        </details>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {sbState.ok && <p className="text-xs text-green-700">Sent back for correction.</p>}
    </div>
  );
}
