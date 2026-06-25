"use client";

import { useActionState, useState } from "react";
import { submitProcessing, type ProcessingState } from "@/app/(processing)/processing/actions";

type Machine = { id: string; name: string; charge_basis: "weight" | "bag" | "hour" | "minute"; rate: number };
type UsageDraft = { machine_id: string; measurement: string };

const initial: ProcessingState = {};

export function ProcessingCard({
  visitId,
  machines,
}: {
  visitId: string;
  machines: Machine[];
}) {
  const [state, action, pending] = useActionState(submitProcessing, initial);
  const [lines, setLines] = useState<UsageDraft[]>([{ machine_id: "", measurement: "" }]);

  function update(i: number, key: keyof UsageDraft, val: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="visit_id" value={visitId} />
      <div className="space-y-2">
        {lines.map((line, i) => {
          const machine = machines.find((m) => m.id === line.machine_id);
          const cost =
            machine && line.measurement ? Number(line.measurement) * Number(machine.rate) : 0;
          return (
            <div key={i} className="flex gap-2 items-center">
              <select
                name={`usage[${i}][machine_id]`}
                value={line.machine_id}
                onChange={(e) => update(i, "machine_id", e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="">— machine —</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (₦{m.rate}/{m.charge_basis})
                  </option>
                ))}
              </select>
              <input
                name={`usage[${i}][measurement]`}
                type="number"
                step="0.001"
                min="0"
                value={line.measurement}
                onChange={(e) => update(i, "measurement", e.target.value)}
                placeholder={machine ? machine.charge_basis : "amount"}
                className="border rounded px-2 py-1 w-32"
              />
              <span className="text-sm text-gray-600">= ₦{cost.toFixed(2)}</span>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="text-sm underline"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setLines((ls) => [...ls, { machine_id: "", measurement: "" }])}
        >
          + Add machine
        </button>
      </div>
      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="px-3 py-2 bg-black text-white rounded"
      >
        {pending ? "Saving..." : "Submit processing"}
      </button>
    </form>
  );
}
