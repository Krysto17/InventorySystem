"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { setLinePrice } from "@/app/visits/[id]/batch-actions";
import { SubmitButton } from "@/components/ui/SubmitButton";

export type AnalysisRow = {
  lineId: string;
  visitId: string;
  date: string;
  supplier: string;
  site: string;
  material: string;
  result: string | null;
  qcWeight: number | null;
  unitPrice: number | null;
  state: string;
  canPrice: boolean;
};

type SortKey = "date" | "supplier" | "site" | "material" | "qcWeight" | "unitPrice";
const COLS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "supplier", label: "Supplier" },
  { key: "site", label: "Site" },
  { key: "material", label: "Material" },
  { key: "qcWeight", label: "QC weight (kg)", numeric: true },
  { key: "unitPrice", label: "Price ₦/kg", numeric: true },
];

// Cross-site XRF analyses for the owner + general manager (#4): a sortable table
// with inline price-setting where the viewer is allowed to price the line.
export function AllAnalysesTable({ rows }: { rows: AnalysisRow[] }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const val = (r: AnalysisRow) => {
      switch (sort) {
        case "qcWeight": return r.qcWeight ?? -1;
        case "unitPrice": return r.unitPrice ?? -1;
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

  if (rows.length === 0) return <p className="text-sm text-gray-500">No XRF analyses yet.</p>;

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
            <th className="px-3 py-2">Result</th>
            <th className="px-3 py-2">Set price</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.lineId} className="border-b hover:bg-gray-50 dark:hover:bg-zinc-900/40">
              <td className="whitespace-nowrap px-3 py-2 text-gray-500">{new Date(r.date).toLocaleDateString()}</td>
              <td className="px-3 py-2">
                <Link href={`/visits/${r.visitId}`} className="font-medium hover:underline">{r.supplier}</Link>
              </td>
              <td className="px-3 py-2">{r.site}</td>
              <td className="px-3 py-2">{r.material}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.qcWeight ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.unitPrice != null ? `₦${r.unitPrice.toLocaleString()}` : "—"}</td>
              <td className="max-w-[18rem] px-3 py-2 text-xs text-gray-600">{r.result ?? "—"}</td>
              <td className="px-3 py-2">
                {r.canPrice ? (
                  <form action={setLinePrice} className="flex items-center gap-1">
                    <input type="hidden" name="visit_id" value={r.visitId} />
                    <input type="hidden" name="visit_material_id" value={r.lineId} />
                    <input
                      type="number"
                      name="unit_price"
                      step="0.01"
                      min="0"
                      defaultValue={r.unitPrice ?? ""}
                      className="w-24 rounded border px-2 py-1 text-sm"
                    />
                    <SubmitButton pendingText="…" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Set</SubmitButton>
                  </form>
                ) : (
                  <span className="text-xs text-gray-400">{r.state === "pricing" ? "—" : "not in pricing"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
