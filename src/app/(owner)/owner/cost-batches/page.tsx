import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { approveCostBatch, rejectCostBatch } from "./actions";
import { deleteCostPriceRun } from "@/app/(manager)/manager/cost-price/actions";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const SELECT = `
  id, label, batch_code, approval_status, total_weight_kg, total_cost_price, avg_cost_price_per_kg,
  sold_at, created_at,
  site:sites(name), material:material_types(name),
  by:profiles!cost_price_runs_created_by_fkey(full_name),
  items:cost_price_run_lots(
    stock_lot:stock_lots(weight_kg, cost_price_per_kg, material:material_types(name), supplier:suppliers(name))
  )
`;

function BatchCard({ r, pending }: { r: Record<string, unknown>; pending: boolean }) {
  const items = (r.items as unknown[]) ?? [];
  const site = g1<{ name: string }>(r.site);
  const mat = g1<{ name: string }>(r.material);
  const by = g1<{ full_name: string }>(r.by);
  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {r.batch_code != null && <Stamp>{r.batch_code as string}</Stamp>}
          <span className="text-sm font-medium">{r.label as string}</span>
          {site?.name && <Badge variant="default">{site.name}</Badge>}
          {mat?.name && <span className="mono text-[11px] uppercase tracking-[0.05em] text-ore">{mat.name}</span>}
        </div>
        <Badge variant="purple">
          {r.avg_cost_price_per_kg != null ? `${ngn(Number(r.avg_cost_price_per_kg))}/kg` : "—"}
        </Badge>
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        {Number(r.total_weight_kg).toFixed(3)} kg · {ngn(Number(r.total_cost_price))} · by {by?.full_name ?? "—"} ·{" "}
        {formatTimestamp((r.sold_at ?? r.created_at) as string)}
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
        {items.map((it, i) => {
          const lot = g1<{ weight_kg: number; cost_price_per_kg: number | null; material: unknown; supplier: unknown }>(
            (it as { stock_lot: unknown }).stock_lot,
          );
          const m = g1<{ name: string }>(lot?.material ?? null);
          const sup = g1<{ name: string }>(lot?.supplier ?? null);
          return (
            <li key={i}>
              {m?.name ?? "—"} · {sup?.name ?? "—"} · {Number(lot?.weight_kg ?? 0).toFixed(3)} kg @{" "}
              {lot?.cost_price_per_kg != null ? `${ngn(Number(lot.cost_price_per_kg))}/kg` : "—"}
            </li>
          );
        })}
      </ul>
      {pending && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <form action={approveCostBatch}>
            <input type="hidden" name="run_id" value={r.id as string} />
            <button type="submit" className="rounded bg-approve px-3 py-1.5 text-xs font-semibold text-white">
              Approve &amp; remove from stock
            </button>
          </form>
          <form action={rejectCostBatch} className="flex items-end gap-2">
            <input type="hidden" name="run_id" value={r.id as string} />
            <input type="text" name="note" placeholder="Reason (optional)" className="rounded border px-2 py-1 text-xs" />
            <button type="submit" className="rounded border px-3 py-1.5 text-xs">Reject</button>
          </form>
        </div>
      )}
    </div>
  );
}

// The director approves manager-formed mixing batches (lots leave stock on
// approval) and reviews every approved/sold batch across all sites.
export default async function OwnerCostBatchesPage() {
  const supabase = await createClient();
  const [{ data: pending }, { data: approved }] = await Promise.all([
    supabase.from("cost_price_runs").select(SELECT)
      .eq("approval_status", "pending").order("created_at", { ascending: true }),
    supabase.from("cost_price_runs").select(SELECT)
      .eq("approval_status", "approved").order("sold_at", { ascending: false }).limit(100),
  ]);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Mixing batches</h1>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Awaiting approval</h2>
            <Badge variant={pending?.length ? "yellow" : "default"}>{pending?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(pending?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No batches awaiting approval.</p>
          ) : (
            (pending ?? []).map((r) => <BatchCard key={r.id as string} r={r as Record<string, unknown>} pending />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Approved &amp; sold ({approved?.length ?? 0})</h2></CardHeader>
        <CardContent className="space-y-4">
          {(approved?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No approved batches yet.</p>
          ) : (
            (approved ?? []).map((r) => <BatchCard key={r.id as string} r={r as Record<string, unknown>} pending={false} />)
          )}
        </CardContent>
      </Card>
    </main>
  );
}
