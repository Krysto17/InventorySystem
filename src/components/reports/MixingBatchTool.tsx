"use client";

import { useMemo, useState, useActionState } from "react";
import { createCostPriceRun } from "@/app/(manager)/manager/cost-price/actions";
import type { ActionResult } from "@/lib/actions/result";

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

const init: ActionResult = { ok: false };
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const kg = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`;
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

  const [state, action, pending] = useActionState(createCostPriceRun, init);
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
  const missingCost = selected.some((l) => l.cost == null);
  const materialsInBatch = new Set(selected.map((l) => l.material_name));
  const mixedMaterials = materialsInBatch.size > 1;

  const toggle = (id: string) =>
    setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const clearPicked = () => setPicked(new Set());

  return (
    <form action={action} className="space-y-4">
      {/* Filters / sort */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium">Material type
          <select value={material} onChange={(e) => setMaterial(e.target.value)} className="mt-1 block rounded border px-2 py-1 text-sm">
            <option value="">All</option>
            {materials.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium">Magnetic (monazite)
          <input value={magQuery} onChange={(e) => setMagQuery(e.target.value)} placeholder="e.g. 65" className="mt-1 block rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs font-medium">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="mt-1 block rounded border px-2 py-1 text-sm">
            <option value="cost_asc">Cost price ↑</option>
            <option value="cost_desc">Cost price ↓</option>
            <option value="magnetic_desc">Magnetic ↓</option>
            <option value="magnetic_asc">Magnetic ↑</option>
            <option value="weight_desc">Weight ↓</option>
          </select>
        </label>
        <label className="flex-1 text-xs font-medium">Search supplier / site
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="name…" className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
        </label>
      </div>

      {/* Available lots to pick */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-ink-2">
          <span>Available lots ({visible.length})</span>
          {selected.length > 0 && (
            <button type="button" onClick={clearPicked} className="hover:underline">Clear selection</button>
          )}
        </div>
        <div className="max-h-80 divide-y divide-line overflow-auto rounded border border-line">
          {visible.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-2">No available lots match.</p>
          ) : (
            visible.map((l) => (
              <label key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <input type="checkbox" name="lot_ids" value={l.id} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                <span className="flex-1">
                  <span className="font-medium">{l.material_name}</span>
                  {l.magnetic ? <span className="ml-2 text-ore">mag {l.magnetic}</span> : null}
                  <span className="ml-2 text-ink-2">· {l.supplier ?? "—"} · {l.site ?? "—"}</span>
                </span>
                <span className="text-ink-2">{kg(l.weight)} · {l.cost != null ? `${ngn(l.cost)}/kg` : <span className="text-reject">no cost</span>}</span>
              </label>
            ))
          )}
        </div>
      </div>

      {/* Computed cost — selected lots in a table */}
      <div className="rounded border border-line">
        <div className="border-b border-line bg-zinc-50 px-3 py-2 text-xs font-semibold text-ink-2 dark:bg-zinc-800/50">
          Computed cost ({selected.length} lot{selected.length === 1 ? "" : "s"})
        </div>
        {selected.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-2">Select lots above to build the batch and compute its weighted cost price.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase text-ink-2">
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Supplier · Site</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">Cost ₦/kg</th>
                  <th className="px-3 py-2 text-right">Line cost</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((l) => (
                  <tr key={l.id} className="border-b border-line/60">
                    <td className="px-3 py-2 font-medium">{l.material_name}{l.magnetic ? <span className="ml-1 text-[10px] text-ore">mag {l.magnetic}</span> : null}</td>
                    <td className="px-3 py-2 text-ink-2">{l.supplier ?? "—"} · {l.site ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{kg(l.weight)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.cost != null ? ngn(l.cost) : <span className="text-reject">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ngn(l.weight * (l.cost ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{kg(totalWeight)}</td>
                  <td className="px-3 py-2 text-right text-ink-2">→</td>
                  <td className="px-3 py-2 text-right tabular-nums">{ngn(totalCost)}</td>
                </tr>
                <tr className="bg-ore/5">
                  <td className="px-3 py-2 font-semibold text-ore" colSpan={4}>Weighted cost price</td>
                  <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-ore">{avgCost > 0 ? `${ngn(avgCost)}/kg` : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Warnings */}
      {mixedMaterials && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          This batch mixes {materialsInBatch.size} different materials ({[...materialsInBatch].join(", ")}). It is tagged to the first lot&rsquo;s material.
        </p>
      )}
      {missingCost && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Some selected lots have no recorded cost price — they count as ₦0 in the weighted average.
        </p>
      )}

      {/* Commit */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded border border-line p-3">
        <label className="flex-1 text-xs font-medium">Batch label
          <input type="text" name="label" required placeholder="e.g. Mixed monazite — June" className="mt-1 block w-full max-w-xs rounded border px-2 py-1 text-sm" />
        </label>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={sell} onChange={(e) => setSell(e.target.checked)} />
            Sell (remove lots from stock, owner approves)
          </label>
          <input type="hidden" name="sell" value={sell ? "1" : "0"} />
          <button type="submit" disabled={selected.length === 0 || pending}
            className="rounded bg-ink px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {pending ? "Saving…" : sell ? "Form batch & sell" : "Save computation"}
          </button>
        </div>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-green-700">{state.message}</p>}
    </form>
  );
}
