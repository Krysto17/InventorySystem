"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type AnalysisRow = {
  id: string;
  visitId: string;
  date: string; // ISO; when the XRF was last recorded
  supplier: string;
  material: string;
  result: string | null;
  qcWeight: number | null;
  mismatch: boolean;
  submitted: boolean;
  unitPrice: number | null; // owner/manager-attached price, visible to QC (#4)
};

type SortKey = "date" | "supplier" | "material" | "qcWeight" | "submitted" | "mismatch" | "unitPrice";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "date", label: "Date" },
  { key: "supplier", label: "Supplier" },
  { key: "material", label: "Material" },
  { key: "qcWeight", label: "QC weight (kg)", numeric: true },
  { key: "unitPrice", label: "Price ₦/kg", numeric: true },
  { key: "submitted", label: "Status" },
  { key: "mismatch", label: "Flag" },
];

// A sortable sheet of every XRF analysis the signed-in QC analyst has recorded
// (#9). Click a column header to sort; click again to flip direction.
export function AnalysesSheet({ rows }: { rows: AnalysisRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const val = (r: AnalysisRow): string | number => {
      switch (sortKey) {
        case "date": return r.date;
        case "supplier": return r.supplier.toLowerCase();
        case "material": return r.material.toLowerCase();
        case "qcWeight": return r.qcWeight ?? -1;
        case "unitPrice": return r.unitPrice ?? -1;
        case "submitted": return r.submitted ? 1 : 0;
        case "mismatch": return r.mismatch ? 1 : 0;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, asc]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else { setSortKey(key); setAsc(key === "supplier" || key === "material"); }
  };

  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-gray-500">No analyses recorded yet.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs uppercase text-gray-500">
          {COLUMNS.map((c) => (
            <th key={c.key} className="px-3 py-2">
              <button type="button" onClick={() => onSort(c.key)} className="font-medium hover:underline">
                {c.label}{sortKey === c.key ? (asc ? " ▲" : " ▼") : ""}
              </button>
            </th>
          ))}
          <th className="px-3 py-2">Result</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id} className="border-b hover:bg-gray-50">
            <td className="px-3 py-2 whitespace-nowrap">{new Date(r.date).toLocaleDateString()}</td>
            <td className="px-3 py-2">
              <Link href={`/visits/${r.visitId}`} className="hover:underline">{r.supplier}</Link>
            </td>
            <td className="px-3 py-2">{r.material}</td>
            <td className="px-3 py-2 tabular-nums">{r.qcWeight ?? "—"}</td>
            <td className="px-3 py-2 tabular-nums">{r.unitPrice != null ? `₦${r.unitPrice.toLocaleString()}` : "—"}</td>
            <td className="px-3 py-2">{r.submitted ? "Submitted" : "Draft"}</td>
            <td className="px-3 py-2">
              {r.mismatch ? <span className="text-red-600 font-medium">Mismatch</span> : "—"}
            </td>
            <td className="px-3 py-2 text-gray-600">{r.result ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
