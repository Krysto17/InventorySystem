"use client";

import { useActionState, useState } from "react";
import { deleteBatch } from "@/app/visits/[id]/batch-actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };

// Two-step confirm before deleting an entire batch supply (#4/#5). Only rendered
// when the viewer is allowed to delete this batch — but the database has the
// final say, and when it refuses (the owner has already approved it, say) that
// refusal is shown rather than swallowed.
export function DeleteBatchButton({ visitId }: { visitId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(deleteBatch, init);

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-sm text-red-600 underline"
        >
          Delete batch
        </button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    );
  }

  return (
    <form action={action} data-confirm="skip" className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="visit_id" value={visitId} />
        <span className="text-sm text-red-600">Delete this entire batch supply?</span>
        <SubmitButton
          pendingText="Deleting…"
          className="rounded bg-red-600 px-2 py-1 text-sm text-white disabled:opacity-50"
        >
          Yes, delete
        </SubmitButton>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm underline"
        >
          Cancel
        </button>
      </div>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
