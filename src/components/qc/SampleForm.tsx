"use client";

import { useActionState, useEffect, useState } from "react";
import { addSample, type SampleState } from "@/app/(qc)/qc/samples/actions";
import { useSupplierSearch } from "@/app/(processing)/processing/intake/useSupplierSearch";

type MaterialType = { id: string; name: string };
const initial: SampleState = {};

export function SampleForm({ materialTypes }: { materialTypes: MaterialType[] }) {
  const [state, action, pending] = useActionState(addSample, initial);
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const { results } = useSupplierSearch(name);

  // Clear the supplier picker after a successful save (form resets the rest).
  useEffect(() => {
    if (state.ok) { setName(""); setSupplierId(""); }
  }, [state]);

  return (
    <form action={action} className="space-y-3 rounded border border-line p-4 max-w-lg">
      <input type="hidden" name="supplier_id" value={supplierId} />
      <label className="block text-sm font-medium">
        Supplier
        <input
          name="supplier_name"
          required
          autoComplete="off"
          value={name}
          onChange={(e) => { setName(e.target.value); setSupplierId(""); }}
          placeholder="Type the supplier name…"
          className="mt-1 block w-full rounded border px-3 py-2"
        />
      </label>
      {results.length > 0 && supplierId === "" && (
        <ul className="rounded border divide-y text-sm">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => { setName(s.name); setSupplierId(s.id); }}
                className="block w-full px-3 py-1.5 text-left hover:bg-gray-50"
              >
                <span className="font-medium">{s.name}</span>
                {s.phone && <span className="ml-2 text-gray-500">{s.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <label className="flex-1 text-sm font-medium">
          Material <span className="font-normal text-gray-400">(optional)</span>
          <select name="material_type_id" defaultValue="" className="mt-1 block w-full rounded border px-2 py-2 text-sm">
            <option value="">—</option>
            {materialTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="w-32 text-sm font-medium">
          Weight (kg)
          <input name="weight_kg" type="number" step="0.001" min="0" className="mt-1 block w-full rounded border px-2 py-2 text-sm" />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Result
        <textarea name="result" required rows={3} placeholder="Sample analysis result…" className="mt-1 block w-full rounded border px-3 py-2 text-sm" />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button type="submit" disabled={pending} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">
        {pending ? "Saving…" : "Record sample"}
      </button>
    </form>
  );
}
