"use client";

import { Fragment, useMemo, useState } from "react";
import { setSamplePrice, deleteSample } from "@/app/(qc)/qc/samples/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { dayLabel, groupByDay } from "@/lib/analyses/group-by-day";

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

// Sample analyses: searchable by supplier and grouped per day (each day
// minimizable), mirroring the supply pipeline's daily records.
export function SampleAnalysesTable({ rows, canPrice = false, canDelete = false }: { rows: SampleRow[]; canPrice?: boolean; canDelete?: boolean }) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => r.supplier.toLowerCase().includes(t)) : rows;
    return groupByDay(f);
  }, [rows, q]);

  const totalCols = 6 + (canPrice ? 1 : 0) + (canDelete ? 1 : 0); // supplier,site,weight,price,material,result
  const toggle = (k: string) => setCollapsed((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if (rows.length === 0) return <p className="text-sm text-gray-500">No sample analyses yet.</p>;

  return (
    <div className="space-y-2">
      <input
        type="text" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search by supplier…"
        className="w-full max-w-xs rounded border px-2 py-1 text-sm" autoComplete="off"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2 text-right">Weight (kg)</th>
              <th className="px-3 py-2 text-right">Price ₦</th>
              <th className="px-3 py-2">Material</th>
              <th className="px-3 py-2">Result</th>
              {canPrice && <th className="px-3 py-2">Set price</th>}
              {canDelete && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr><td colSpan={totalCols} className="px-3 py-3 text-gray-500">No matches.</td></tr>
            ) : groups.map((g) => {
              const isCollapsed = collapsed.has(g.key);
              return (
                <Fragment key={g.key}>
                  <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                    <td colSpan={totalCols} className="px-3 py-1.5">
                      <button type="button" onClick={() => toggle(g.key)} className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <span>{isCollapsed ? "▸" : "▾"} {dayLabel(g.rows[0].date)}</span>
                        <span>{g.rows.length}</span>
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed && g.rows.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-gray-50 dark:hover:bg-zinc-900/40">
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
                      {canDelete && (
                        <td className="px-3 py-2">
                          {r.price == null ? (
                            <form action={deleteSample} data-confirm="skip"
                              onSubmit={(e) => { if (!confirm("Delete this sample analysis?")) e.preventDefault(); }}>
                              <input type="hidden" name="sample_id" value={r.id} />
                              <button type="submit" title="Delete sample" className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40">Delete</button>
                            </form>
                          ) : (
                            <span className="text-[11px] text-gray-400">priced</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
