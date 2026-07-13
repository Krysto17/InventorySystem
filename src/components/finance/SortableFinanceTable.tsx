"use client";

import { useMemo, useState } from "react";

export type FinanceItem = {
  type: "Advance" | "Processing fee" | "Consumable";
  date: string;
  site: string;
  supplier: string;
  amount: number;
};

type SortKey = "date" | "site" | "supplier" | "type" | "amount";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Owner's itemised finance breakdown — sortable by date, site or supplier (and
// type/amount), filterable by category. Client-side for instant re-sorting.
export function SortableFinanceTable({ items }: { items: FinanceItem[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | FinanceItem["type"]>("all");

  const rows = useMemo(() => {
    const filtered = typeFilter === "all" ? items : items.filter((i) => i.type === typeFilter);
    return [...filtered].sort((a, b) => {
      const cmp =
        sortKey === "amount"
          ? a.amount - b.amount
          : String(a[sortKey]).localeCompare(String(b[sortKey]));
      return asc ? cmp : -cmp;
    });
  }, [items, sortKey, asc, typeFilter]);

  const total = rows.reduce((s, r) => s + r.amount, 0);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setAsc((v) => !v);
    else { setSortKey(key); setAsc(key === "amount" ? false : true); }
  };
  const arrow = (key: SortKey) => (sortKey === key ? (asc ? " ▲" : " ▼") : "");
  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-4 py-2 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(key)} className="font-medium hover:underline">
        {label}{arrow(key)}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-1 text-sm">
        <span className="text-zinc-500">Show:</span>
        {(["all", "Advance", "Processing fee", "Consumable"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTypeFilter(t)}
            className={`rounded border px-2 py-0.5 text-xs ${typeFilter === t ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black" : "border-line hover:bg-zinc-50 dark:hover:bg-zinc-900/40"}`}
          >
            {t === "all" ? "All" : t + "s"}
          </button>
        ))}
        <span className="ml-auto text-zinc-500">{rows.length} rows · <span className="font-semibold text-ink">{ngn(total)}</span></span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-xs text-zinc-500">
            <tr>
              {th("date", "Date")}
              {th("site", "Site")}
              {th("supplier", "Supplier")}
              {th("type", "Type")}
              {th("amount", "Amount", true)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-3 text-zinc-500">No entries in range.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-b border-line/60">
                <td className="px-4 py-2 whitespace-nowrap">{r.date.slice(0, 10)}</td>
                <td className="px-4 py-2">{r.site}</td>
                <td className="px-4 py-2">{r.supplier}</td>
                <td className="px-4 py-2 text-zinc-500">{r.type}</td>
                <td className="px-4 py-2 text-right font-medium">{ngn(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
