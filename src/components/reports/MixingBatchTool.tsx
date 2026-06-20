"use client";

import { useMemo, useState } from "react";
import { createCostPriceRun } from "@/app/(manager)/manager/cost-price/actions";

export type Lot = {
  id: string;
  material_type_id: string;
  material_name: string;
  magnetic: string | null;
  cost: number | null;
  weight: number;
  supplier: string | null;
  site: string | null;
};

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const magNum = (m: string | null): number => {
  if (!m) return NaN;
  const x = parseFloat(m.replace(/[^0-9.]/g, ""));
  return Number.isFinite(x) ? x : NaN;
};

type SortKey = "cost_asc" | "cost_desc" | "magnetic_desc" | "magnetic_asc" | "weight_desc";

export function MixingBatchTool({ lots }: { lots: Lot[] }) {
  const materials = useMemo(
    () => Array.from(new Map(lots.map((l) => [l.material_type_id, l.material_name])).entries()),
    [lots],
  );

  const [material, setMaterial] = useState("");
  const [magQuery, setMagQuery] = useState("");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SortKey>("cost_asc");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sell, setSell] = useState(true);

  const visible = useMemo(() => {
    let rows = lots.slice();
    if (material) rows = rows.filter((l) => l.material_type_id === material);
    if (magQuery.trim()) {
      const q = magQuery.trim().toLowerCase();
      rows = rows.filter((l) => (l.magnetic ?? "").toLowerCase().includes(q));
    }
    if (text.trim()) {
      const q = text.trim().toLowerCase();
      rows = rows.filter(
        (l) =>
          l.material_name.toLowerCase().includes(q) ||
          (l.supplier ?? "").toLowerCase().includes(q) ||
          (l.site ?? "").toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => {
      switch (sort) {
        case "cost_asc": return (a.cost ?? Infinity) - (b.cost ?? Infinity);
        case "cost_desc": return (b.cost ?? -Infinity) - (a.cost ?? -Infinity);
        case "weight_desc": return b.weight - a.weight;
        case "magnetic_desc": return (magNum(b.magnetic) || -Infinity) - (magNum(a.magnetic) || -Infinity);
        case "magnetic_asc": return (magNum(a.magnetic) || Infinity) - (magNum(b.magnetic) || Infinity);
      }
    });
    return rows;
  }, [lots, material, magQuery, text, sort]);

  const selected = lots.filter((l) => picked.has(l.id));
  const totalWeight = selected.reduce((s, l) => s + l.weight, 0);
  const totalCost = selected.reduce((s, l) => s + l.weight * (l.cost ?? 0), 0);
  const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <form action={createCostPriceRun} className="space-y-4">
      {/* Filters / sort */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium">Material type
          <select value={material} onChange={(e) => setMaterial(e.target.value)}
            className="mt-1 block rounded border px-2 py-1 text-sm">
            <option value="">All</option>
            {materials.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium">Magnetic (monazite)
          <input value={magQuery} onChange={(e) => setMagQuery(e.target.value)} placeholder="e.g. 65"
            className="mt-1 block rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs font-medium">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="mt-1 block rounded border px-2 py-1 text-sm">
            <option value="cost_asc">Cost price ↑</option>
            <option value="cost_desc">Cost price ↓</option>
            <option value="magnetic_desc">Magnetic ↓</option>
            <option value="magnetic_asc">Magnetic ↑</option>
            <option value="weight_desc">Weight ↓</option>
          </select>
        </label>
        <label className="flex-1 text-xs font-medium">Search supplier / site
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="name…"
            className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>

      {/* Lot list */}
      <div className="max-h-96 divide-y overflow-auto rounded border">
        {visible.length === 0 ? (
          <p className="px-3 py-3 text-sm text-zinc-500">No available lots match.</p>
        ) : (
          visible.map((l) => (
            <label key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <input type="checkbox" name="lot_ids" value={l.id} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
              <span className="flex-1">
                <span className="font-medium">{l.material_name}</span>
                {l.magnetic ? <span className="ml-2 text-ore">mag {l.magnetic}</span> : null}
                <span className="ml-2 text-zinc-500">· {l.supplier ?? "—"} · {l.site ?? "—"}</span>
              </span>
              <span className="text-zinc-500">{l.weight.toFixed(3)} kg · {l.cost != null ? `${ngn(l.cost)}/kg` : "—"}</span>
            </label>
          ))
        )}
      </div>

      {/* Selection summary + commit */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="text-sm">
          <div className="font-semibold">{selected.length} lot(s) selected</div>
          <div className="text-zinc-500">
            {totalWeight.toFixed(3)} kg · total {ngn(totalCost)} · weighted {avgCost > 0 ? `${ngn(avgCost)}/kg` : "—"}
          </div>
        </div>
        <div className="flex items-end gap-3">
          <label className="text-xs font-medium">Batch label
            <input type="text" name="label" required placeholder="e.g. Mixed monazite — June"
              className="mt-1 block rounded border px-2 py-1 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={sell} onChange={(e) => setSell(e.target.checked)} />
            Sell (remove lots from stock)
          </label>
          <input type="hidden" name="sell" value={sell ? "1" : "0"} />
          <button type="submit" disabled={selected.length === 0}
            className="rounded bg-black px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {sell ? "Form batch & sell" : "Save computation"}
          </button>
        </div>
      </div>
    </form>
  );
}
