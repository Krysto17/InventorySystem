"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setLinePrice, setPriceAgreed, unsettleLine } from "@/app/visits/[id]/batch-actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { dayLabel, groupByDay } from "@/lib/analyses/group-by-day";

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
  priceAgreed: boolean;
  state: string;
  canPrice: boolean;
  settlementStatus: string; // 'settled' | 'unsettled' (released)
  agreed: boolean;          // price agreed (past the pricing stage)
  unsettledReason: string | null;
  gatePassId: string | null;
  canRelease: boolean;      // owner may hand the material back on a gate pass
};

// Material that fails XRF spec, or that no price was agreed on, goes back to the
// supplier. Releasing it withdraws the line from the batch and raises the gate
// pass it leaves the yard on, in one step.
function ReleaseMaterial({ row }: { row: AnalysisRow }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded border border-reject px-2 py-1 text-xs text-reject hover:bg-reject-soft">
        Release
      </button>
    );
  }
  return (
    <form action={unsettleLine} className="flex items-center gap-1"
      data-confirm={`Release this ${row.material} back to ${row.supplier} and issue a gate pass? It leaves the batch.`}>
      <input type="hidden" name="visit_id" value={row.visitId} />
      <input type="hidden" name="visit_material_id" value={row.lineId} />
      <input type="text" name="reason" required placeholder="Reason (out of spec / no price)"
        className="w-52 rounded border px-2 py-1 text-xs" autoComplete="off" autoFocus />
      <SubmitButton pendingText="…" className="rounded bg-reject px-2 py-1 text-xs text-white disabled:opacity-50">
        Release
      </SubmitButton>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-xs text-ink-2 hover:underline">
        Cancel
      </button>
    </form>
  );
}

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
function Table({ rows, mode, isOwner }: { rows: AnalysisRow[]; mode: "pricing" | "closed"; isOwner: boolean }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sorted = useSorter(rows, sort, asc);
  const toggle = (k: SortKey) => (k === sort ? setAsc((v) => !v) : (setSort(k), setAsc(false)));
  const toggleDay = (k: string) => setCollapsed((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const groups = groupByDay(sorted);
  const totalCols = COLS.length + 2;

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
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
            <Fragment key={g.key}>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50">
              <td colSpan={totalCols} className="px-3 py-1.5">
                <button type="button" onClick={() => toggleDay(g.key)} className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  <span>{isCollapsed ? "▸" : "▾"} {dayLabel(g.rows[0].date)}</span>
                  <span>{g.rows.length}</span>
                </button>
              </td>
            </tr>
            {!isCollapsed && g.rows.map((r) => (
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
                  r.settlementStatus === "unsettled" ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="rounded bg-reject px-1.5 py-0.5 text-[10px] font-medium text-white" title={r.unsettledReason ?? undefined}>
                        Released
                      </span>
                      {r.gatePassId && (
                        <a href={`/api/pdf/gate-pass/${r.gatePassId}`} target="_blank" rel="noopener"
                          className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-zinc-50">
                          Gate pass
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">Settled</span>
                  )
                ) : r.canPrice ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <form action={setLinePrice} className="flex items-center gap-1">
                      <input type="hidden" name="visit_id" value={r.visitId} />
                      <input type="hidden" name="visit_material_id" value={r.lineId} />
                      <input type="number" name="unit_price" step="0.01" min="0" defaultValue={r.unitPrice ?? ""} className="w-24 rounded border px-2 py-1 text-sm" />
                      <SubmitButton pendingText="…" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">Set</SubmitButton>
                    </form>
                    {/* The owner's explicit "this price is agreed" signal — the
                        manager forwards for payment on it. Price stays editable. */}
                    {isOwner && r.unitPrice != null && (
                      <form action={setPriceAgreed} data-confirm="skip">
                        <input type="hidden" name="visit_id" value={r.visitId} />
                        <input type="hidden" name="visit_material_id" value={r.lineId} />
                        <input type="hidden" name="agreed" value={r.priceAgreed ? "0" : "1"} />
                        <SubmitButton pendingText="…" className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${r.priceAgreed ? "bg-approve-soft text-approve" : "border border-line hover:bg-zinc-50"}`}>
                          {r.priceAgreed ? "✓ Agreed" : "Agree price"}
                        </SubmitButton>
                      </form>
                    )}
                    {!isOwner && r.priceAgreed && (
                      <span className="rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">✓ Price agreed</span>
                    )}
                    {r.canRelease && <ReleaseMaterial row={r} />}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">
                    {r.priceAgreed ? <span className="rounded bg-approve-soft px-1.5 py-0.5 text-[10px] font-medium text-approve">✓ Price agreed</span> : "not in pricing"}
                  </span>
                )}
              </td>
            </tr>
            ))}
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Cross-site XRF analyses: searchable by supplier or material. Analyses still in
// pricing are the primary table; settled/withdrawn ones live in a separate table
// so the working view stays clean.
export function AllAnalysesTable({
  rows, isOwner = false, query = "", basePath = "/owner/analyses",
}: {
  rows: AnalysisRow[];
  isOwner?: boolean;
  query?: string;
  basePath?: string;
}) {
  const router = useRouter();
  // Supplier / material / site / result are matched in Postgres — this table
  // gains a row per material line forever. Weight and price are matched here,
  // over the page already loaded, so "65" still finds a 65kg line.
  const [draft, setDraft] = useState(query);
  const [numeric, setNumeric] = useState("");

  const { inPricing, closed } = useMemo(() => {
    const t = numeric.trim();
    const num = (v: number | null) => (v == null ? "" : String(v));
    const f = t
      ? rows.filter((r) => num(r.qcWeight).includes(t) || num(r.unitPrice).includes(t))
      : rows;
    return {
      inPricing: f.filter((r) => !r.agreed && r.settlementStatus !== "unsettled"),
      closed: f.filter((r) => r.agreed || r.settlementStatus === "unsettled"),
    };
  }, [rows, numeric]);

  if (rows.length === 0) return <p className="text-sm text-gray-500">No XRF analyses yet.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <form
          data-confirm="skip"
          onSubmit={(e) => { e.preventDefault(); router.push(draft ? `${basePath}?q=${encodeURIComponent(draft)}` : basePath); }}
          className="flex items-center gap-1"
        >
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search supplier, material, site, result…"
            className="w-full max-w-xs rounded border px-2 py-1 text-sm"
            autoComplete="off"
          />
          <button type="submit" className="rounded border px-2 py-1 text-xs hover:bg-zinc-50">Search</button>
          {query && (
            <button type="button" onClick={() => { setDraft(""); router.push(basePath); }}
              className="px-1 text-xs text-ink-2 hover:underline">Clear</button>
          )}
        </form>
        <input
          type="search"
          value={numeric}
          onChange={(e) => setNumeric(e.target.value)}
          placeholder="Filter by weight or price…"
          className="w-44 rounded border px-2 py-1 text-sm"
          autoComplete="off"
        />
      </div>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">In pricing ({inPricing.length})</h3>
        <Table isOwner={isOwner} rows={inPricing} mode="pricing" />
      </section>
      <section>
        {/* Settled analyses stay folded away so the working view is just what
            still needs pricing — open it when you want the history. */}
        <details>
          <summary className="mb-2 cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-2 hover:underline">
            Settled &amp; closed ({closed.length})
          </summary>
          <Table isOwner={isOwner} rows={closed} mode="closed" />
        </details>
      </section>
    </div>
  );
}
