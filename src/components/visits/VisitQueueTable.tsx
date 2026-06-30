"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type QueueRow = {
  id: string;
  supplier: string;
  material: string;
  weight: number;
  date: string;
  extra?: string | null; // optional trailing column (e.g. grade, site, status)
};

type SortKey = "date" | "supplier" | "weight";

// A queue rendered as a table sortable by date, supplier name, or weight (#8).
export function VisitQueueTable({
  rows,
  emptyText = "Queue is empty.",
  extraLabel,
}: {
  rows: QueueRow[];
  emptyText?: string;
  extraLabel?: string;
}) {
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const val = (r: QueueRow) =>
      sort === "weight" ? r.weight : sort === "supplier" ? r.supplier.toLowerCase() : r.date;
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
  }, [rows, sort, asc]);

  function toggle(k: SortKey) {
    if (k === sort) setAsc((v) => !v);
    else { setSort(k); setAsc(k === "date"); }
  }
  const arrow = (k: SortKey) => (sort === k ? (asc ? " ▲" : " ▼") : "");

  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-gray-500">{emptyText}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-gray-500">
            <th className="px-4 py-2"><button type="button" onClick={() => toggle("date")} className="hover:underline">Date{arrow("date")}</button></th>
            <th className="px-4 py-2"><button type="button" onClick={() => toggle("supplier")} className="hover:underline">Supplier{arrow("supplier")}</button></th>
            <th className="px-4 py-2">Material</th>
            <th className="px-4 py-2 text-right"><button type="button" onClick={() => toggle("weight")} className="hover:underline">Weight (kg){arrow("weight")}</button></th>
            {extraLabel && <th className="px-4 py-2 text-right">{extraLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b hover:bg-gray-50 dark:hover:bg-zinc-900/40">
              <td className="whitespace-nowrap px-4 py-2 text-gray-500">
                <Link href={`/visits/${r.id}`} className="hover:underline">{new Date(r.date).toLocaleDateString()}</Link>
              </td>
              <td className="px-4 py-2"><Link href={`/visits/${r.id}`} className="font-medium hover:underline">{r.supplier}</Link></td>
              <td className="px-4 py-2 text-gray-600">{r.material}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.weight > 0 ? r.weight.toFixed(2) : "—"}</td>
              {extraLabel && <td className="px-4 py-2 text-right text-gray-600">{r.extra ?? "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
