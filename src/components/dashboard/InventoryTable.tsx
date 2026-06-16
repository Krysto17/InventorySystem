"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { formatNaira, formatWeight } from "@/lib/visits/format";

export type StockRow = {
  site: string;
  material: string;
  grade: string | null;
  weight: number;
  value: number;
};

type SortKey = "material" | "weight" | "value";

const PAGE_SIZE = 8;

export function InventoryTable({
  rows,
  canCreateVisit,
}: {
  rows: StockRow[];
  canCreateVisit: boolean;
}) {
  const [material, setMaterial] = useState("");
  const [site, setSite] = useState("");
  const [sort, setSort] = useState<SortKey>("value");
  const [page, setPage] = useState(0);

  const materials = useMemo(
    () => Array.from(new Set(rows.map((r) => r.material))).sort(),
    [rows],
  );
  const sites = useMemo(
    () => Array.from(new Set(rows.map((r) => r.site))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (material) out = out.filter((r) => r.material === material);
    if (site) out = out.filter((r) => r.site === site);
    out = [...out].sort((a, b) => {
      if (sort === "material") return a.material.localeCompare(b.material);
      if (sort === "weight") return b.weight - a.weight;
      return b.value - a.value;
    });
    return out;
  }, [rows, material, site, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const selectClass =
    "rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";

  return (
    <div className="rounded-[var(--radius-card)] border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <h2 className="mr-auto text-sm font-semibold text-zinc-900 dark:text-zinc-50">Live stock</h2>
        <select
          value={material}
          onChange={(e) => { setMaterial(e.target.value); setPage(0); }}
          className={selectClass}
          aria-label="Filter by material"
        >
          <option value="">All materials</option>
          {materials.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={site}
          onChange={(e) => { setSite(e.target.value); setPage(0); }}
          className={selectClass}
          aria-label="Filter by site"
        >
          <option value="">All sites</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className={selectClass}
          aria-label="Sort by"
        >
          <option value="value">Sort: Value</option>
          <option value="weight">Sort: Stock</option>
          <option value="material">Sort: Material</option>
        </select>
        {canCreateVisit && (
          <Link
            href="/processing/intake"
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={15} /> New Visit
          </Link>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2 text-left font-medium">Material</th>
              <th className="px-4 py-2 text-left font-medium">Grade</th>
              <th className="hidden px-4 py-2 text-left font-medium sm:table-cell">Site</th>
              <th className="px-4 py-2 text-right font-medium">Stock</th>
              <th className="px-4 py-2 text-right font-medium">Est. value</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No stock on hand.
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr
                  key={`${r.site}-${r.material}-${r.grade ?? ""}-${i}`}
                  className="border-b border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-[10px] font-semibold uppercase text-brand-700 dark:bg-brand-600/15 dark:text-brand-100">
                        {r.material.slice(0, 2)}
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">{r.material}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-300">{r.grade ?? "—"}</td>
                  <td className="hidden px-4 py-2.5 text-zinc-600 dark:text-zinc-300 sm:table-cell">{r.site}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-zinc-900 dark:text-zinc-50">
                    {formatWeight(r.weight)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-600 dark:text-zinc-300">
                    {r.value > 0 ? formatNaira(r.value) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between p-3 text-xs text-zinc-500">
          <span>
            {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-md border border-zinc-200 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded-md border border-zinc-200 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
