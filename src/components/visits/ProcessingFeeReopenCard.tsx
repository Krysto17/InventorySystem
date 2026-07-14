"use client";

import { useActionState, useState } from "react";
import { resaveProcessingFee, type ProcessingState } from "@/app/(processing)/processing/actions";

type Machine = { id: string; name: string; charge_basis: string; rate: number };
type UsageDraft = { machine_id: string; measurement: string };

const initial: ProcessingState = {};

// Processing employee corrects the machine usage after a manager sent the fee
// back. Submitting recomputes the processing fee in place (no state change).
export function ProcessingFeeReopenCard({
  visitId,
  machines,
  initialUsage,
}: {
  visitId: string;
  machines: Machine[];
  initialUsage: UsageDraft[];
}) {
  const [state, action, pending] = useActionState(resaveProcessingFee, initial);
  const [usage, setUsage] = useState<UsageDraft[]>(initialUsage.length ? initialUsage : [{ machine_id: "", measurement: "" }]);
  const up = (i: number, k: keyof UsageDraft, v: string) =>
    setUsage((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="visit_id" value={visitId} />
      <p className="text-xs text-ink-2">Correct the machine usage — the processing fee recomputes and is sent back to accounting.</p>
      {usage.map((line, i) => {
        const machine = machines.find((m) => m.id === line.machine_id);
        const cost = machine && line.measurement ? Number(line.measurement) * Number(machine.rate) : 0;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select name={`usage[${i}][machine_id]`} value={line.machine_id} onChange={(e) => up(i, "machine_id", e.target.value)} className="rounded border px-2 py-1 text-sm">
              <option value="">— machine —</option>
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name} (₦{m.rate}/{m.charge_basis})</option>)}
            </select>
            <input name={`usage[${i}][measurement]`} type="number" step="0.001" min="0" value={line.measurement}
              onChange={(e) => up(i, "measurement", e.target.value)} placeholder={machine ? machine.charge_basis : "amount"} className="w-28 rounded border px-2 py-1 text-sm" />
            <span className="text-xs text-ink-2">= ₦{cost.toFixed(2)}</span>
            {usage.length > 1 && (
              <button type="button" className="text-xs underline" onClick={() => setUsage((ls) => ls.filter((_, idx) => idx !== i))}>Remove</button>
            )}
          </div>
        );
      })}
      <button type="button" className="text-xs underline" onClick={() => setUsage((ls) => [...ls, { machine_id: "", measurement: "" }])}>+ Add machine</button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      <div>
        <button type="submit" disabled={pending} className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save corrected fee"}
        </button>
      </div>
    </form>
  );
}
