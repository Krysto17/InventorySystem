"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { ApprovalChain } from "@/components/visits/ApprovalChain";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";

export type WorkflowRow = {
  id: string;
  supplier: string;
  material: string;
  site: string;
  state: VisitState;
  entryPath: "unprocessed" | "processed";
  priceApproved: boolean;
  date: string;
};

const PREVIEW = 10;
type Sort = "newest" | "oldest" | "supplier";

// Live supply pipeline (#6/#7): searchable by supplier, sortable by date/time or
// supplier, collapsed to 10 rows with a toggle to expand to the full list.
export function LiveWorkflowList({ rows }: { rows: WorkflowRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => r.supplier.toLowerCase().includes(t)) : rows;
    return [...f].sort((a, b) =>
      sort === "supplier"
        ? a.supplier.localeCompare(b.supplier)
        : sort === "oldest"
          ? a.date.localeCompare(b.date)
          : b.date.localeCompare(a.date),
    );
  }, [rows, q, sort]);

  const shown = expanded ? filtered : filtered.slice(0, PREVIEW);

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
            {shown.map((v) => (
              <li key={v.id} className="border-b-[1.5px] border-line px-4 py-3 last:border-b-0">
                <Link href={`/visits/${v.id}`} className="block">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Stamp>{v.id.slice(0, 8).toUpperCase()}</Stamp>
                      <strong className="text-ink">{v.supplier}</strong>
                      <span className="text-ink-2">· {v.material} · {v.site}</span>
                      <span className="mono text-[11px] text-ink-2">{new Date(v.date).toLocaleString()}</span>
                    </div>
                    <Badge variant={stateVariant(v.state)}>{STATE_LABELS[v.state] ?? v.state}</Badge>
                  </div>
                  <div className="mt-2">
                    <ApprovalChain state={v.state} entryPath={v.entryPath} priceApproved={v.priceApproved} />
                  </div>
                </Link>
              </li>
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
