"use client";

import { useState } from "react";
import { useSupplierSearch, type SupplierRow } from "./useSupplierSearch";

export function SupplierSearch({
  onSelect,
  onAddNew,
}: {
  onSelect: (s: SupplierRow) => void;
  onAddNew: () => void;
}) {
  const [q, setQ] = useState("");
  const { results, searching } = useSupplierSearch(q);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Start typing a supplier name or phone…"
        className="w-full border rounded px-3 py-2"
        autoComplete="off"
      />
      {searching && <p className="text-sm text-gray-500">Searching…</p>}
      {results.length > 0 && (
        <ul className="border rounded divide-y">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50"
              >
                <span className="font-medium">{s.name}</span>
                {s.phone && <span className="ml-2 text-sm text-gray-500">{s.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-sm text-gray-600">
          No existing supplier matches.{" "}
          <button type="button" className="underline" onClick={onAddNew}>
            Add new supplier
          </button>
        </p>
      )}
      {/* Always allow proceeding to add-new even while matches show, so the user
          can consciously create a distinct supplier. */}
      {(results.length > 0 || q.trim().length < 2) && (
        <button type="button" className="text-sm underline text-gray-600" onClick={onAddNew}>
          + Add a new supplier instead
        </button>
      )}
    </div>
  );
}
