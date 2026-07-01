"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type SupplierListRow = {
  id: string;
  name: string;
  phone: string | null;
  code: string | null;
  formerNames: string[];
};

// Client-side searchable/sortable supplier directory (#4). The full list is
// small, so filtering happens in the browser for instant results.
export function SupplierSearchList({ suppliers }: { suppliers: SupplierListRow[] }) {
  const [q, setQ] = useState("");
  const [asc, setAsc] = useState(true);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = !t
      ? suppliers
      : suppliers.filter(
          (s) =>
            s.name.toLowerCase().includes(t) ||
            (s.phone ?? "").toLowerCase().includes(t) ||
            (s.code ?? "").toLowerCase().includes(t) ||
            s.formerNames.some((f) => f.toLowerCase().includes(t)),
        );
    return [...filtered].sort((a, b) =>
      asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  }, [q, asc, suppliers]);

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, phone, or code…"
        className="w-full max-w-md rounded border px-3 py-2"
        autoComplete="off"
      />
      <p className="text-xs text-gray-500">{rows.length} of {suppliers.length} suppliers</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">
                <button type="button" onClick={() => setAsc((v) => !v)} className="hover:underline">
                  Name{asc ? " ▲" : " ▼"}
                </button>
              </th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Also known as</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b hover:bg-gray-50 dark:hover:bg-zinc-900/40">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/suppliers/${s.id}`} className="hover:underline">{s.name}</Link>
                </td>
                <td className="px-3 py-2 mono text-xs text-gray-500">{s.code ?? "—"}</td>
                <td className="px-3 py-2 text-gray-600">{s.phone ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{s.formerNames.length ? s.formerNames.join(", ") : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-500">No matching suppliers.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
