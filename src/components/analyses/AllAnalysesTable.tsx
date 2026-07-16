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
  settlementStatus: string; // 'settled' | 'unsettled'
  agreed: boolean;          // price agreed (past the pricing stage)
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

function useSorter(rows: AnalysisRow[], sort: SortKey, asc: boolean) {
  return useMemo(() => {
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
}

// One sortable table; the "In pricing" table shows an inline price-setter, the
// "Settled & closed" table is read-only.
function Table({ rows, mode }: { rows: AnalysisRow[]; mode: "pricing" | "closed" }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const sorted = useSorter(rows, sort, asc);
  const toggle = (k: SortKey) => (k === sort ? setAsc((v) => !v) : (setSort(k), setAsc(false)));

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">{mode === "pricing" ? "Nothing awaiting pricing." : "No settled analyses."}</p>;
  }
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
            <th className="px-3 py-2">{mode === "pricing" ? "Set price" : "Status"}</th>
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
                {mode === "closed" ? (
                  r.settlementStatus === "unsettled"
                    ? <span className="rounded bg-reject px-1.5 py-0.5 text-[10px] font-medium text-white">Withdrawn</span>
                    : <span className="rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">Settled</span>
                ) : r.canPrice ? (
                  <form action={setLinePrice} className="flex items-center gap-1">
                    <input type="hidden" name="visit_id" value={r.visitId} />
                    <input type="hidden" name="visit_material_id" value={r.lineId} />
                    <input type="number" name="unit_price" step="0.01" min="0" defaultValue={r.unitPrice ?? ""} className="w-24 rounded border px-2 py-1 text-sm" />
                    <SubmitButton pendingText="…" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Set</SubmitButton>
                  </form>
                ) : (
                  <span className="text-xs text-gray-400">not in pricing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Cross-site XRF analyses: searchable by supplier or material. Analyses still in
// pricing are the primary table; settled/withdrawn ones live in a separate table
// so the working view stays clean.
export function AllAnalysesTable({ rows }: { rows: AnalysisRow[] }) {
  const [q, setQ] = useState("");

  const { inPricing, closed } = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => r.supplier.toLowerCase().includes(t) || r.material.toLowerCase().includes(t)) : rows;
    return {
      inPricing: f.filter((r) => !r.agreed && r.settlementStatus !== "unsettled"),
      closed: f.filter((r) => r.agreed || r.settlementStatus === "unsettled"),
    };
  }, [rows, q]);

  if (rows.length === 0) return <p className="text-sm text-gray-500">No XRF analyses yet.</p>;

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by supplier or material…"
        className="w-full max-w-xs rounded border px-2 py-1 text-sm"
        autoComplete="off"
      />
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">In pricing ({inPricing.length})</h3>
        <Table rows={inPricing} mode="pricing" />
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Settled &amp; closed ({closed.length})</h3>
        <Table rows={closed} mode="closed" />
      </section>
    </div>
  );
}
