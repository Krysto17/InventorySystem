"use client";

import { useActionState, useOptimistic, useRef, useState } from "react";
import { submitProcessing, addProcessingMaterialLine, type ProcessingState } from "@/app/(processing)/processing/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";

type Machine = { id: string; name: string; charge_basis: "weight" | "bag" | "hour" | "minute"; rate: number };
type MaterialType = { id: string; name: string };
type UsageDraft = { machine_id: string; measurement: string };
export type ProcLine = {
  id: string;
  weight_kg: number;
  materialName: string | null;
  comment: string | null;
  pending?: boolean;
};

const initial: ProcessingState = {};

export function ProcessingCard({
  visitId,
  machines,
  materialTypes,
  initialLines = [],
}: {
  visitId: string;
  machines: Machine[];
  materialTypes: MaterialType[];
  initialLines?: ProcLine[];
}) {
  const [state, action, pending] = useActionState(submitProcessing, initial);
  const [lines, setLines] = useState<UsageDraft[]>([{ machine_id: "", measurement: "" }]);

  // Material lines (e.g. iron weights) are added optimistically so each entry
  // shows up instantly while the server insert runs.
  const [matLines, addOptimisticMat] = useOptimistic(
    initialLines,
    (cur: ProcLine[], line: ProcLine) => [...cur, line],
  );
  const matFormRef = useRef<HTMLFormElement>(null);

  function update(i: number, key: keyof UsageDraft, val: string) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [key]: val } : l)));
  }

  // Default the material select to Iron when present (New-Site processing).
  const defaultMaterial = materialTypes.find((m) => m.name === "Iron")?.id ?? materialTypes[0]?.id ?? "";

  async function addMaterial(formData: FormData) {
    const materialId = String(formData.get("material_type_id") ?? "");
    if (!materialId || !(Number(formData.get("weight_kg")) >= 0)) return;
    addOptimisticMat({
      id: `optimistic-${crypto.randomUUID()}`,
      weight_kg: Number(formData.get("weight_kg")) || 0,
      materialName: materialTypes.find((m) => m.id === materialId)?.name ?? "…",
      comment: String(formData.get("receiving_comment") ?? "").trim() || null,
      pending: true,
    });
    matFormRef.current?.reset();
    await addProcessingMaterialLine(formData);
  }

  return (
    <div className="space-y-4">
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

    {/* Material entry (e.g. iron weight) — a supplier can have several lines.
        Comments are visible to the General manager. */}
    <form ref={matFormRef} action={addMaterial} className="space-y-2 rounded border border-line p-3">
      <div className="text-xs font-semibold text-ink-2">Add material (weight)</div>
      {matLines.length > 0 && (
        <ul className="space-y-1">
          {matLines.map((l) => (
            <li
              key={l.id}
              className={`flex items-center justify-between rounded bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-800/50 ${
                l.pending ? "opacity-60" : ""
              }`}
            >
              <span>
                {l.materialName ?? "—"}
                {l.comment ? <span className="text-zinc-500"> · {l.comment}</span> : null}
                {l.pending ? <span className="ml-1 text-zinc-400">saving…</span> : null}
              </span>
              <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
                {l.weight_kg.toFixed(3)} kg
              </span>
            </li>
          ))}
        </ul>
      )}
      <input type="hidden" name="visit_id" value={visitId} />
      <div className="flex flex-wrap gap-2">
        <select name="material_type_id" defaultValue={defaultMaterial} required
          className="rounded border px-2 py-1 text-sm">
          {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input name="weight_kg" type="number" step="0.001" min="0" required placeholder="weight (kg)"
          className="w-32 rounded border px-2 py-1 text-sm" />
      </div>
      <input name="receiving_comment" type="text" placeholder="Comment (optional)"
        className="block w-full rounded border px-2 py-1 text-sm" />
      <SubmitButton
        pendingText="Adding…"
        className="rounded border px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
      >
        + Add material
      </SubmitButton>
    </form>
    </div>
  );
}
