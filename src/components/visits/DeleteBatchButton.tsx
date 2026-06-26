"use client";

import { useState } from "react";
import { deleteBatch } from "@/app/visits/[id]/batch-actions";

// Two-step confirm before deleting an entire batch supply (#4/#5). Only rendered
// when the viewer (owner or general manager) is allowed to delete this batch.
export function DeleteBatchButton({ visitId }: { visitId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-red-600 underline"
      >
        Delete batch
      </button>
    );
  }

  return (
    <form action={deleteBatch} className="flex items-center gap-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <span className="text-sm text-red-600">Delete this entire batch supply?</span>
      <button type="submit" className="text-sm px-2 py-1 bg-red-600 text-white rounded">
        Yes, delete
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-sm underline"
      >
        Cancel
      </button>
    </form>
  );
}
