"use client";

import { useState, useActionState } from "react";
import { createVisit, type IntakeState } from "../actions";
import { SupplierSearch } from "./SupplierSearch";

type MaterialType = { id: string; name: string };
type Supplier = { id: string; name: string; phone: string | null };

const initialState: IntakeState = {};

export function IntakeForm({ materialTypes }: { materialTypes: MaterialType[] }) {
  const [state, formAction, pending] = useActionState(createVisit, initialState);
  const [picked, setPicked] = useState<Supplier | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  return (
    <form action={formAction} className="space-y-6 max-w-lg">
      <section className="space-y-3">
        <h2 className="font-semibold">Supplier</h2>
        {!picked && !addingNew && (
          <SupplierSearch
            onSelect={(s) => { setPicked(s); setAddingNew(false); }}
            onAddNew={() => { setAddingNew(true); setPicked(null); }}
          />
        )}
        {picked && (
          <div className="border rounded p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{picked.name}</div>
              <div className="text-sm text-gray-500">{picked.phone}</div>
            </div>
            <button type="button" className="underline text-sm" onClick={() => setPicked(null)}>
              Change
            </button>
            <input type="hidden" name="supplier_id" value={picked.id} />
          </div>
        )}
        {addingNew && (
          <div className="border rounded p-3 space-y-2">
            <input
              name="new_supplier_name"
              placeholder="Name"
              required
              className="w-full border rounded px-3 py-2"
            />
            <input
              name="new_supplier_phone"
              placeholder="Phone"
              className="w-full border rounded px-3 py-2"
            />
            <input
              name="new_supplier_notes"
              placeholder="Notes"
              className="w-full border rounded px-3 py-2"
            />
            <button
              type="button"
              className="underline text-sm"
              onClick={() => setAddingNew(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Visit</h2>
        <input
          name="vehicle_plate"
          placeholder="Vehicle plate"
          className="w-full border rounded px-3 py-2"
        />
        <select
          name="declared_material_type_id"
          required
          className="w-full border rounded px-3 py-2"
        >
          <option value="">— select material —</option>
          {materialTypes.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <fieldset className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" name="entry_path" value="unprocessed" required /> Unprocessed
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="entry_path" value="pre_processed" required /> Pre-processed
          </label>
        </fieldset>
        <p className="text-xs text-gray-500">
          Unprocessed visits start at processing; pre-processed visits go straight to receiving.
        </p>
      </section>

      {state.error && <p className="text-red-600 text-sm">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 bg-black text-white rounded"
      >
        {pending ? "Saving..." : "Create visit"}
      </button>
    </form>
  );
}
