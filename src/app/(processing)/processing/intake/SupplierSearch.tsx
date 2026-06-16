"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type SupplierRow = { id: string; name: string; phone: string | null };

export function SupplierSearch({
  onSelect,
  onAddNew,
}: {
  onSelect: (s: SupplierRow) => void;
  onAddNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SupplierRow[]>([]);
  const [searching, startSearch] = useTransition();

  function runSearch() {
    if (!q.trim()) { setResults([]); return; }
    startSearch(async () => {
      const supabase = createClient();
      const term = q.trim();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .or(`phone.ilike.%${term}%,name.ilike.%${term}%`)
        .limit(10);
      setResults((data ?? []) as SupplierRow[]);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
          placeholder="Phone or name"
          className="flex-1 border rounded px-3 py-2"
        />
        <button type="button" onClick={runSearch} className="px-3 py-2 border rounded">
          {searching ? "..." : "Search"}
        </button>
      </div>
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
      {q.trim() && !searching && results.length === 0 && (
        <p className="text-sm text-gray-600">
          No match.{" "}
          <button type="button" className="underline" onClick={onAddNew}>
            Add new supplier
          </button>
        </p>
      )}
    </div>
  );
}
