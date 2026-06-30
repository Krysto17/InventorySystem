"use client";

import { useActionState, useState } from "react";
import { submitProcessing, type ProcessingState } from "@/app/(processing)/processing/actions";

type Machine = { id: string; name: string; charge_basis: "weight" | "bag" | "hour" | "minute"; rate: number };
type MaterialType = { id: string; name: string };
type UsageDraft = { machine_id: string; measurement: string };
type MatDraft = { material_type_id: string; weight_kg: string; comment: string };

const initial: ProcessingState = {};

// Single processing form: one Submit records the material weights AND the
// machine-usage processing fee together (#7), with a per-batch discount and a
// Clear button to reset everything before submitting (#1).
export function ProcessingCard({
  visitId,
  machines,
  materialTypes,
}: {
  visitId: string;
  machines: Machine[];
  materialTypes: MaterialType[];
}) {
  const [state, action, pending] = useActionState(submitProcessing, initial);
  const defaultMaterial = materialTypes.find((m) => m.name === "Iron")?.id ?? materialTypes[0]?.id ?? "";
  const newUsage = (): UsageDraft => ({ machine_id: "", measurement: "" });
  const newMat = (): MatDraft => ({ material_type_id: defaultMaterial, weight_kg: "", comment: "" });

  const [usage, setUsage] = useState<UsageDraft[]>([newUsage()]);
  const [mats, setMats] = useState<MatDraft[]>([newMat()]);
  const [discount, setDiscount] = useState("");

  const upUsage = (i: number, k: keyof UsageDraft, v: string) =>
    setUsage((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const upMat = (i: number, k: keyof MatDraft, v: string) =>
    setMats((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  function clearAll() {
    setUsage([newUsage()]);
    setMats([newMat()]);
    setDiscount("");
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="visit_id" value={visitId} />

      {/* Machine usage → processing fee */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-ink-2">Processing fee (machine usage)</div>
        {usage.map((line, i) => {
          const machine = machines.find((m) => m.id === line.machine_id);
          const cost = machine && line.measurement ? Number(line.measurement) * Number(machine.rate) : 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                name={`usage[${i}][machine_id]`}
                value={line.machine_id}
                onChange={(e) => upUsage(i, "machine_id", e.target.value)}
                className="rounded border px-2 py-1"
              >
                <option value="">— machine —</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} (₦{m.rate}/{m.charge_basis})</option>
                ))}
              </select>
              <input
                name={`usage[${i}][measurement]`}
                type="number"
                step="0.001"
                min="0"
                value={line.measurement}
                onChange={(e) => upUsage(i, "measurement", e.target.value)}
                placeholder={machine ? machine.charge_basis : "amount"}
                className="w-28 rounded border px-2 py-1"
              />
              <span className="text-sm text-gray-600">= ₦{cost.toFixed(2)}</span>
              {usage.length > 1 && (
                <button type="button" className="text-sm underline" onClick={() => setUsage((ls) => ls.filter((_, idx) => idx !== i))}>
                  Remove
                </button>
              )}
            </div>
          );
        })}
        <button type="button" className="text-sm underline" onClick={() => setUsage((ls) => [...ls, newUsage()])}>
          + Add machine
        </button>
      </div>

      {/* Material lines (e.g. iron weights) — submitted with the same Submit */}
      <div className="space-y-2 border-t border-line pt-3">
        <div className="text-xs font-semibold text-ink-2">Materials (weight)</div>
        {mats.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              name={`material[${i}][material_type_id]`}
              value={m.material_type_id}
              onChange={(e) => upMat(i, "material_type_id", e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            >
              {materialTypes.map((mt) => <option key={mt.id} value={mt.id}>{mt.name}</option>)}
            </select>
            <input
              name={`material[${i}][weight_kg]`}
              type="number"
              step="0.001"
              min="0"
              value={m.weight_kg}
              onChange={(e) => upMat(i, "weight_kg", e.target.value)}
              placeholder="weight (kg)"
              className="w-28 rounded border px-2 py-1 text-sm"
            />
            <input
              name={`material[${i}][comment]`}
              type="text"
              value={m.comment}
              onChange={(e) => upMat(i, "comment", e.target.value)}
              placeholder="comment (optional)"
              className="flex-1 min-w-[10rem] rounded border px-2 py-1 text-sm"
            />
            {mats.length > 1 && (
              <button type="button" className="text-sm underline" onClick={() => setMats((ls) => ls.filter((_, idx) => idx !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="text-sm underline" onClick={() => setMats((ls) => [...ls, newMat()])}>
          + Add material
        </button>
      </div>

      {/* Per-batch processing discount (visible to managers on the visit) */}
      <label className="flex items-center gap-2 text-sm border-t border-line pt-3">
        Processing discount %
        <input
          name="discount_percent"
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="0"
          className="w-24 rounded border px-2 py-1"
        />
        <span className="text-xs text-gray-500">applied to this batch&apos;s fee</span>
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {pending ? "Saving…" : "Submit processing"}
        </button>
        <button type="button" onClick={clearAll} className="rounded border px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800">
          Clear
        </button>
      </div>
    </form>
  );
}
