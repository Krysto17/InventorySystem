"use client";

import { useMemo, useState } from "react";
import { setSamplePrice } from "@/app/(qc)/qc/samples/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";

export type SampleRow = {
  id: string;
  date: string;
  supplier: string;
  site: string;
  material: string;
  weight: number | null;
  result: string | null;
  price: number | null;
};

type SortKey = "date" | "supplier" | "site" | "weight" | "price";
const COLS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "supplier", label: "Supplier" },
  { key: "site", label: "Site" },
  { key: "weight", label: "Weight (kg)", numeric: true },
  { key: "price", label: "Price ₦", numeric: true },
];

// Sample analyses table. `canPrice` shows an inline flat-price form (owner/GM).
export function SampleAnalysesTable({ rows, canPrice = false }: { rows: SampleRow[]; canPrice?: boolean }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const val = (r: SampleRow) => {
      switch (sort) {
        case "weight": return r.weight ?? -1;
        case "price": return r.price ?? -1;
        case "date": return r.date;
        default: return (r[sort] as string).toLowerCase();
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
  }, [rows, sort, asc]);

  function toggle(k: SortKey) {
    if (k === sort) setAsc((v) => !v);
    else { setSort(k); setAsc(false); }
  }

  if (rows.length === 0) return <p className="text-sm text-gray-500">No sample analyses yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-gray-500">
            {COLS.map((c) => (
              <th key={c.key} className={`px-3 py-2 ${c.numeric ? "text-right" : ""}`}>
                <button type="button" onClick={() => toggle(c.key)} className="hover:underline">
                  {c.label}{sort === c.key ? (asc ? " ▲" : " ▼") : ""}
                </button>
              </th>
            ))}
            <th className="px-3 py-2">Material</th>
            <th className="px-3 py-2">Result</th>
            {canPrice && <th className="px-3 py-2">Set price</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b hover:bg-gray-50 dark:hover:bg-zinc-900/40">
              <td className="whitespace-nowrap px-3 py-2 text-gray-500">{new Date(r.date).toLocaleDateString()}</td>
              <td className="px-3 py-2">
                <span className="font-medium">{r.supplier}</span>
                <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">sample</span>
              </td>
              <td className="px-3 py-2">{r.site}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.weight ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.price != null ? `₦${r.price.toLocaleString()}` : "—"}</td>
              <td className="px-3 py-2 text-gray-600">{r.material}</td>
              <td className="max-w-[18rem] px-3 py-2 text-xs text-gray-600">{r.result ?? "—"}</td>
              {canPrice && (
                <td className="px-3 py-2">
                  <form action={setSamplePrice} className="flex items-center gap-1">
                    <input type="hidden" name="sample_id" value={r.id} />
                    <input type="number" name="price" step="0.01" min="0" defaultValue={r.price ?? ""} placeholder="₦" className="w-24 rounded border px-2 py-1 text-sm" />
                    <SubmitButton pendingText="…" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Set</SubmitButton>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
