"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { ApprovalChain } from "@/components/visits/ApprovalChain";
import { STATE_LABELS, PROGRESS_ORDER, type VisitState } from "@/lib/visits/state-machine";

export type WorkflowRow = {
  id: string;
  supplier: string;
  material: string;
  site: string;
  state: VisitState;
  entryPath: "unprocessed" | "processed";
  priceApproved: boolean;
  unsettled: boolean;
  date: string;
};

const PREVIEW = 10;
type Sort = "progress" | "newest" | "oldest" | "supplier";
const dayKey = (iso: string) => iso.slice(0, 10);
const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

// Open pipeline states — the batches still moving. Terminal / side states get
// their own sections so the main pipeline stays uncluttered.
const OPEN_STATES = new Set<VisitState>([
  "in_processing", "in_receiving", "awaiting_manager", "in_qc",
  "pricing", "awaiting_price_approval", "in_accounting", "awaiting_stock_intake",
]);

function RowLine({ v, withChain = true }: { v: WorkflowRow; withChain?: boolean }) {
  return (
    <li className="border-b-[1.5px] border-line px-4 py-3 last:border-b-0">
      <Link href={`/visits/${v.id}`} className="block">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Stamp>{v.id.slice(0, 8).toUpperCase()}</Stamp>
            <strong className="text-ink">{v.supplier}</strong>
            <span className="text-ink-2">· {v.material} · {v.site}</span>
            <span className="mono text-[11px] text-ink-2">{new Date(v.date).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            {v.unsettled && <Badge variant="red">Unsettled</Badge>}
            <Badge variant={stateVariant(v.state)}>{STATE_LABELS[v.state] ?? v.state}</Badge>
          </div>
        </div>
        {withChain && (
          <div className="mt-2">
            <ApprovalChain state={v.state} entryPath={v.entryPath} priceApproved={v.priceApproved} />
          </div>
        )}
      </Link>
    </li>
  );
}

// A minimizable section (card) for a terminal/side group — collapsed by default.
function CollapsibleSection({ title, rows, tone }: { title: string; rows: WorkflowRow[]; tone: "yellow" | "green" | "default" }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <Card>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2">
          <span className="text-xs text-ink-2">{open ? "▾" : "▸"}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
          <Badge variant={tone}>{rows.length}</Badge>
        </span>
      </button>
      {open && <CardContent className="p-0"><ul className="border-t border-line">{rows.map((v) => <RowLine key={v.id} v={v} withChain={false} />)}</ul></CardContent>}
    </Card>
  );
}

// Live supply pipeline: searchable by supplier or material, sortable, grouped
// per day with each day minimizable. Stocked / exited / awaiting-gate-pass are
// split into their own minimizable sections to keep the dashboard clean.
export function LiveWorkflowList({ rows }: { rows: WorkflowRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("progress");
  const [expanded, setExpanded] = useState(false);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  const open = useMemo(() => rows.filter((r) => OPEN_STATES.has(r.state)), [rows]);
  const gatePass = useMemo(() => rows.filter((r) => r.state === "awaiting_gate_exit"), [rows]);
  const stocked = useMemo(() => rows.filter((r) => r.state === "stocked"), [rows]);
  const exited = useMemo(() => rows.filter((r) => r.state === "exited"), [rows]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? open.filter((r) => r.supplier.toLowerCase().includes(t) || r.material.toLowerCase().includes(t)) : open;
    return [...f].sort((a, b) => {
      if (sort === "supplier") return a.supplier.localeCompare(b.supplier);
      if (sort === "oldest") return a.date.localeCompare(b.date);
      if (sort === "newest") return b.date.localeCompare(a.date);
      const dk = dayKey(b.date).localeCompare(dayKey(a.date));
      if (dk !== 0) return dk;
      return (PROGRESS_ORDER[a.state] ?? 0) - (PROGRESS_ORDER[b.state] ?? 0);
    });
  }, [open, q, sort]);

  const grouped = sort === "progress";
  const nonGroupedShown = expanded ? filtered : filtered.slice(0, PREVIEW);

  const toggleDay = (k: string) =>
    setCollapsedDays((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Live workflow — supply pipeline</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search supplier or material…"
              className="rounded border px-2 py-1 text-xs"
              autoComplete="off"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border px-2 py-1 text-xs">
              <option value="progress">By progress (per day)</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="supplier">Supplier A–Z</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {open.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No open supplies in the pipeline.</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No matches.</p>
          ) : grouped ? (
            <ul>
              {(() => {
                const out: React.ReactNode[] = [];
                let lastDay = "";
                for (const v of filtered) {
                  const dk = dayKey(v.date);
                  if (dk !== lastDay) {
                    lastDay = dk;
                    const count = filtered.filter((r) => dayKey(r.date) === dk).length;
                    const isCollapsed = collapsedDays.has(dk);
                    out.push(
                      <li key={`h-${dk}`}>
                        <button type="button" onClick={() => toggleDay(dk)}
                          className="flex w-full items-center justify-between border-b-[1.5px] border-line bg-zinc-50 px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-2 hover:bg-zinc-100 dark:bg-zinc-800/50">
                          <span>{isCollapsed ? "▸" : "▾"} {dayLabel(v.date)}</span>
                          <span className="normal-case">{count} suppl{count === 1 ? "y" : "ies"}</span>
                        </button>
                      </li>,
                    );
                  }
                  if (!collapsedDays.has(dk)) out.push(<RowLine key={v.id} v={v} />);
                }
                return out;
              })()}
            </ul>
          ) : (
            <>
              <ul>{nonGroupedShown.map((v) => <RowLine key={v.id} v={v} />)}</ul>
              {filtered.length > PREVIEW && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="w-full border-t border-line px-4 py-2 text-center text-xs font-medium text-ink-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  {expanded ? "Show less" : `Show all (${filtered.length})`}
                </button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <CollapsibleSection title="Awaiting gate pass" rows={gatePass} tone="yellow" />
      <CollapsibleSection title="Stocked" rows={stocked} tone="green" />
      <CollapsibleSection title="Exited (no agreement)" rows={exited} tone="default" />
    </div>
  );
}
