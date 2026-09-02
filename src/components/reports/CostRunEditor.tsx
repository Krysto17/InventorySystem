"use client";

import { useActionState } from "react";
import {
  renameCostPriceRun, removeRunLot, addRunExtra, updateRunExtra, removeRunExtra,
} from "@/app/(manager)/manager/cost-price/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ActionForm } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/actions/result";

const init: ActionResult = { ok: false };
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const kg = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;

export type RunLot = { stockLotId: string; material: string; supplier: string | null; weight: number; cost: number | null };
export type RunExtra = { id: string; name: string; weight: number; cost: number };

// Correct a computed cost price after the fact: rename it, drop a stocked lot,
// or add/edit/remove an external material. The weighted cost recomputes in the
// DB. Only rendered while the batch isn't sold.
export function CostRunEditor({
  runId, label, lots, extras,
}: {
  runId: string; label: string; lots: RunLot[]; extras: RunExtra[];
}) {
  const [nameState, nameAction, renaming] = useActionState(renameCostPriceRun, init);
  const [addState, addAction, adding] = useActionState(addRunExtra, init);
  const [editState, editAction, editing] = useActionState(updateRunExtra, init);
  const field = "rounded border border-line px-2 py-1 text-sm";

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-[11px] font-semibold text-ink-2 hover:underline">Edit computation</summary>
      <div className="mt-2 space-y-3 rounded border border-line p-3">
        {/* Rename */}
        <form action={nameAction} data-confirm="skip" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="run_id" value={runId} />
          <label className="text-xs font-medium">Label
            <input type="text" name="label" defaultValue={label} required className={`mt-1 block w-56 ${field}`} />
          </label>
          <SubmitButton pendingText="Saving…" className="rounded border border-line px-2 py-1 text-xs hover:bg-paper disabled:opacity-50">Rename</SubmitButton>
          {nameState.error && <span className="text-xs text-red-600">{nameState.error}</span>}
        </form>

        {/* Stocked lots — removable (the lot returns to available stock) */}
        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">Stocked lots ({lots.length})</div>
          {lots.length === 0 ? (
            <p className="text-xs text-ink-2">No stocked lots in this batch.</p>
          ) : (
            <ul className="divide-y divide-line text-xs">
              {lots.map((l) => (
                <li key={l.stockLotId} className="flex items-center justify-between gap-2 py-1">
                  <span>
                    <span className="font-medium">{l.material}</span>
                    <span className="text-ink-2"> · {l.supplier ?? "—"} · {kg(l.weight)} @ {l.cost != null ? `${ngn(l.cost)}/kg` : "—"}</span>
                  </span>
                  <ActionForm action={removeRunLot} data-confirm="Remove this lot from the batch? It stays in stock.">
                    <input type="hidden" name="run_id" value={runId} />
                    <input type="hidden" name="stock_lot_id" value={l.stockLotId} />
                    <SubmitButton pendingText="…" className="rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-50">Remove</SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* External materials — editable + removable */}
        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">External materials ({extras.length})</div>
          {extras.map((e) => (
            <div key={e.id} className="mb-1 flex flex-wrap items-end gap-1">
              <form action={editAction} data-confirm="skip" className="flex flex-wrap items-end gap-1">
                <input type="hidden" name="extra_id" value={e.id} />
                <input type="text" name="material_name" defaultValue={e.name} required className={`w-40 ${field}`} />
                <input type="number" name="weight_kg" step="0.001" min="0.001" defaultValue={e.weight} required className={`w-24 ${field}`} />
                <input type="number" name="cost_price_per_kg" step="0.01" min="0" defaultValue={e.cost} required className={`w-24 ${field}`} />
                <SubmitButton pendingText="…" className="rounded border border-line px-2 py-1 text-[10px] hover:bg-paper disabled:opacity-50">Save</SubmitButton>
              </form>
              {/* Its own form: as a formAction button inside the edit form, React
                  threw the removal's result away, so a refused delete looked done. */}
              <ActionForm action={removeRunExtra} data-confirm="Remove this external material?">
                <input type="hidden" name="extra_id" value={e.id} />
                <SubmitButton pendingText="…" className="rounded border border-red-300 px-1.5 py-1 text-[10px] text-red-700 hover:bg-red-50 disabled:opacity-50">Remove</SubmitButton>
              </ActionForm>
            </div>
          ))}
          {editState.error && <p className="text-xs text-red-600">{editState.error}</p>}

          {/* Add another external material */}
          <form action={addAction} data-confirm="skip" className="mt-2 flex flex-wrap items-end gap-1 border-t border-line pt-2">
            <input type="hidden" name="run_id" value={runId} />
            <input type="text" name="material_name" placeholder="Material (bought outside)" required className={`w-40 ${field}`} />
            <input type="number" name="weight_kg" placeholder="kg" step="0.001" min="0.001" required className={`w-24 ${field}`} />
            <input type="number" name="cost_price_per_kg" placeholder="₦/kg" step="0.01" min="0" required className={`w-24 ${field}`} />
            <SubmitButton pendingText="Adding…" className="rounded border border-line px-2 py-1 text-[10px] hover:bg-paper disabled:opacity-50">Add</SubmitButton>
            {addState.error && <span className="text-xs text-red-600">{addState.error}</span>}
          </form>
        </div>

        <p className="text-[11px] text-ink-2">
          The weighted cost price recalculates automatically. {renaming || adding || editing ? "Saving…" : ""}
        </p>
      </div>
    </details>
  );
}
