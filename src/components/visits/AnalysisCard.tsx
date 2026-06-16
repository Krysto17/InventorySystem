"use client";

import { useActionState } from "react";
import { submitAnalysis, type AnalysisState } from "@/app/(receiving)/receiving/actions";

const initial: AnalysisState = {};

export function AnalysisCard({ visitId }: { visitId: string }) {
  const [state, action, pending] = useActionState(submitAnalysis, initial);

  return (
    <form action={action} className="space-y-3 max-w-lg">
      <input type="hidden" name="visit_id" value={visitId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col text-sm">
          Weight (kg) *
          <input
            name="weight"
            type="number"
            step="0.001"
            min="0"
            required
            className="border rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          Sample ID
          <input name="sample_id" className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Grade
          <input name="grade" placeholder="e.g. B+" className="border rounded px-2 py-1" />
        </label>
        <label className="flex flex-col text-sm">
          Purity (%)
          <input
            name="purity"
            type="number"
            step="0.01"
            min="0"
            max="100"
            className="border rounded px-2 py-1"
          />
        </label>
      </div>
      <label className="flex flex-col text-sm">
        XRF result (JSON)
        <textarea
          name="xrf_result"
          rows={3}
          placeholder='{"Sn": 58.2, "Fe": 12.1}'
          className="border rounded px-2 py-1 font-mono text-xs"
        />
      </label>
      <label className="flex flex-col text-sm">
        QC observations
        <textarea name="qc_observations" rows={2} className="border rounded px-2 py-1" />
      </label>
      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-2 bg-black text-white rounded"
      >
        {pending ? "Saving..." : "Submit analysis"}
      </button>
    </form>
  );
}
