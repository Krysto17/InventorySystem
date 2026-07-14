"use client";

import { useActionState } from "react";
import { recordAdjustment, type IntakeState } from "@/app/(inventory)/inventory/actions";

type Site = { id: string; name: string };
type MaterialType = { id: string; name: string };
const init: IntakeState = {};

// Owner-only manual stock correction (in/out), e.g. spoilage, recount, or a
// found discrepancy. Recorded as an 'adjustment' stock movement.
export function StockAdjustmentForm({ sites, materialTypes }: { sites: Site[]; materialTypes: MaterialType[] }) {
  const [state, action, pending] = useActionState(recordAdjustment, init);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="text-sm">Site
        <select name="site_id" required defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
          <option value="" disabled>Select site…</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="text-sm">Material
        <select name="material_type_id" required defaultValue="" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
          <option value="" disabled>Select material…</option>
          {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <label className="text-sm">Direction
        <select name="direction" defaultValue="in" className="mt-1 block w-full rounded border px-2 py-1 text-sm">
          <option value="in">Add to stock (+)</option>
          <option value="out">Remove from stock (−)</option>
        </select>
      </label>
      <label className="text-sm">Weight (kg)
        <input type="number" name="weight" min="0.001" step="0.001" required className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">Grade <span className="font-normal text-gray-400">(optional)</span>
        <input type="text" name="grade" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <label className="text-sm">Reason / note <span className="font-normal text-gray-400">(optional)</span>
        <input type="text" name="notes" placeholder="e.g. recount, spoilage" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "Recording…" : "Record adjustment"}
        </button>
        {state.error && <p className="mt-1 text-xs text-red-600">{state.error}</p>}
      </div>
    </form>
  );
}
