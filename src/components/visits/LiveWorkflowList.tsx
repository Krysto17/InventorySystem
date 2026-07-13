"use client";

import { Fragment, useMemo, useState } from "react";
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

// Live supply pipeline (#6/#7): searchable by supplier, sortable by progress
// (grouped per day), date/time or supplier, collapsed to 10 rows with a toggle.
export function LiveWorkflowList({ rows }: { rows: WorkflowRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("progress");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => r.supplier.toLowerCase().includes(t)) : rows;
    return [...f].sort((a, b) => {
      if (sort === "supplier") return a.supplier.localeCompare(b.supplier);
      if (sort === "oldest") return a.date.localeCompare(b.date);
      if (sort === "newest") return b.date.localeCompare(a.date);
      // Progress: group by day (newest day first), then by pipeline progress.
      const dk = dayKey(b.date).localeCompare(dayKey(a.date));
      if (dk !== 0) return dk;
      return (PROGRESS_ORDER[a.state] ?? 0) - (PROGRESS_ORDER[b.state] ?? 0);
    });
  }, [rows, q, sort]);

  const shown = expanded ? filtered : filtered.slice(0, PREVIEW);
  const grouped = sort === "progress";

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Live workflow — supply pipeline</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search supplier…"
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
        {shown.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-2">{rows.length === 0 ? "No visits yet." : "No matches."}</p>
        ) : (
          <ul>
            {shown.map((v, i) => (
              <Fragment key={v.id}>
              {grouped && (i === 0 || dayKey(shown[i - 1].date) !== dayKey(v.date)) && (
                <li className="border-b-[1.5px] border-line bg-zinc-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2 dark:bg-zinc-800/50">
                  {dayLabel(v.date)}
                </li>
              )}
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
                  <div className="mt-2">
                    <ApprovalChain state={v.state} entryPath={v.entryPath} priceApproved={v.priceApproved} />
                  </div>
                </Link>
              </li>
              </Fragment>
            ))}
          </ul>
        )}
        {filtered.length > PREVIEW && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full border-t border-line px-4 py-2 text-center text-xs font-medium text-ink-2 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            {expanded ? "Show less" : `Show all (${filtered.length})`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
