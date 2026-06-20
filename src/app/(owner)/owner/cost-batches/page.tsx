import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// The director reviews every sold-out mixing batch (manager-formed) with its
// constituent lots and weighted cost prices, across all sites.
export default async function OwnerCostBatchesPage() {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("cost_price_runs")
    .select(`
      id, label, batch_code, total_weight_kg, total_cost_price, avg_cost_price_per_kg, sold_at, created_at,
      site:sites(name), material:material_types(name),
      by:profiles!cost_price_runs_created_by_fkey(full_name),
      items:cost_price_run_lots(
        stock_lot:stock_lots(weight_kg, cost_price_per_kg, material:material_types(name), supplier:suppliers(name))
      )
    `)
    .eq("sold", true)
    .order("sold_at", { ascending: false })
    .limit(100);

  const grandWeight = (runs ?? []).reduce((s, r) => s + Number(r.total_weight_kg), 0);
  const grandCost = (runs ?? []).reduce((s, r) => s + Number(r.total_cost_price), 0);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Sold-out batches</h1>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-6 py-4 text-sm">
          <div><span className="text-zinc-500">Batches</span><div className="text-lg font-bold">{runs?.length ?? 0}</div></div>
          <div><span className="text-zinc-500">Total weight</span><div className="text-lg font-bold">{grandWeight.toFixed(3)} kg</div></div>
          <div><span className="text-zinc-500">Total cost</span><div className="text-lg font-bold">{ngn(grandCost)}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">All sold batches</h2></CardHeader>
        <CardContent className="space-y-4">
          {(runs?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No sold batches yet.</p>
          ) : (
            (runs ?? []).map((r) => {
              const items = (r as { items: unknown[] }).items ?? [];
              const site = g1<{ name: string }>((r as { site: unknown }).site);
              const mat = g1<{ name: string }>((r as { material: unknown }).material);
              const by = g1<{ full_name: string }>((r as { by: unknown }).by);
              return (
                <div key={r.id as string} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
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
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </main>
  );
}
