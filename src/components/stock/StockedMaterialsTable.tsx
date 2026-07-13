"use client";

import { useMemo, useState } from "react";

export type StockedRow = {
  id: string;
  date: string;
  supplier: string;
  supplierCode: string | null;
  material: string;
  weight: number;
  site: string;
  paid: "Paid" | "Unpaid" | "—";
};

type SortKey = "date" | "material" | "paid" | "supplier" | "weight";

// Every stocked material: supplier, type, weight, paid status. Sortable by date,
// material type and status. Client-side for instant re-sorting.
export function StockedMaterialsTable({ rows }: { rows: StockedRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = !t
      ? rows
      : rows.filter(
          (r) =>
            r.supplier.toLowerCase().includes(t) ||
            r.material.toLowerCase().includes(t) ||
            (r.supplierCode ?? "").toLowerCase().includes(t) ||
            r.site.toLowerCase().includes(t),
        );
    return [...filtered].sort((a, b) => {
      const cmp =
        sortKey === "weight"
          ? a.weight - b.weight
          : String(a[sortKey]).localeCompare(String(b[sortKey]));
      return asc ? cmp : -cmp;
    });
  }, [rows, sortKey, asc, q]);

  const totalWeight = view.reduce((s, r) => s + r.weight, 0);
  const onSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else { setSortKey(key); setAsc(key === "weight" ? false : true); }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ▲" : " ▼") : "");
  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-4 py-2 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(key)} className="font-medium hover:underline">
        {label}{arrow(key)}
      </button>
    </th>
  );

  const badge = (paid: StockedRow["paid"]) =>
    paid === "Paid"
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : paid === "Unpaid"
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search supplier, material, site…"
          className="w-full max-w-xs rounded border px-3 py-1.5 text-sm"
          autoComplete="off"
        />
        <span className="ml-auto text-xs text-zinc-500">
          {view.length} lots · <span className="font-semibold text-ink">{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-xs text-zinc-500">
            <tr>
              {th("date", "Date stocked")}
              {th("supplier", "Supplier")}
              {th("material", "Material")}
              {th("weight", "Weight (kg)", true)}
              {th("paid", "Status")}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-3 text-zinc-500">No stocked materials.</td></tr>
            ) : view.map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="px-4 py-2 whitespace-nowrap">{r.date.slice(0, 10)}</td>
                <td className="px-4 py-2">
                  {r.supplier}
                  {r.supplierCode && <span className="ml-1 text-xs text-zinc-400">{r.supplierCode}</span>}
                  <div className="text-xs text-zinc-400">{r.site}</div>
                </td>
                <td className="px-4 py-2">{r.material}</td>
                <td className="px-4 py-2 text-right">{r.weight.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                <td className="px-4 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${badge(r.paid)}`}>{r.paid}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
