import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { MixingBatchTool, type Lot } from "@/components/reports/MixingBatchTool";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default async function ManagerCostPricePage() {
  const supabase = await createClient();

  const [{ data: lotsRaw }, { data: runs }] = await Promise.all([
    supabase
      .from("stock_lots")
      .select(`
        id, weight_kg, cost_price_per_kg, material_type_id,
        material:material_types(name), supplier:suppliers(name), site:sites(name),
        line:visit_materials!stock_lots_ref_visit_material_id_fkey(magnetic_analysis)
      `)
      .eq("status", "available")
      .order("created_at", { ascending: true })
      .limit(300),
    supabase
      .from("cost_price_runs")
      .select(`
        id, label, batch_code, sold, approval_status, total_weight_kg, total_cost_price, avg_cost_price_per_kg, created_at,
        material:material_types(name),
        items:cost_price_run_lots(
          stock_lot:stock_lots(weight_kg, cost_price_per_kg, material:material_types(name), supplier:suppliers(name))
        )
      `)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const lots: Lot[] = (lotsRaw ?? []).map((l) => ({
    id: l.id as string,
    material_type_id: l.material_type_id as string,
    material_name: g1<{ name: string }>((l as { material: unknown }).material)?.name ?? "—",
    magnetic: g1<{ magnetic_analysis: string | null }>((l as { line: unknown }).line)?.magnetic_analysis ?? null,
    cost: l.cost_price_per_kg != null ? Number(l.cost_price_per_kg) : null,
    weight: Number(l.weight_kg),
    supplier: g1<{ name: string }>((l as { supplier: unknown }).supplier)?.name ?? null,
    site: g1<{ name: string }>((l as { site: unknown }).site)?.name ?? null,
  }));

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Cost price &amp; mixing batches</h1>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Form a mixing batch</h2>
          <p className="text-xs text-zinc-500">
            Search/sort available stock, hand-pick lots, then form a batch. Selling a batch removes
            each lot from stock and records the weighted cost price.
          </p>
        </CardHeader>
        <CardContent>
          {lots.length === 0 ? (
            <p className="text-sm text-zinc-500">No available stock lots to combine.</p>
          ) : (
            <MixingBatchTool lots={lots} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Recent batches ({runs?.length ?? 0})</h2></CardHeader>
        <CardContent className="space-y-4">
          {(runs?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No batches yet.</p>
          ) : (
            (runs ?? []).map((r) => {
              const items = (r as { items: unknown[] }).items ?? [];
              const runMat = g1<{ name: string }>((r as { material: unknown }).material);
              return (
                <div key={r.id as string} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.batch_code != null && <Stamp>{r.batch_code as string}</Stamp>}
                      <span className="text-sm font-medium">{r.label as string}</span>
                      {runMat?.name && <span className="mono text-[11px] uppercase tracking-[0.05em] text-ore">{runMat.name}</span>}
                      {(() => {
                        const st = r.approval_status as string | null;
                        if (st === "approved") return <Badge variant="paid">Sold</Badge>;
                        if (st === "pending") return <Badge variant="yellow">Awaiting owner approval</Badge>;
                        if (st === "rejected") return <Badge variant="red">Rejected</Badge>;
                        return <Badge variant="default">Computation</Badge>;
                      })()}
                    </div>
                    <Badge variant="purple">
                      {r.avg_cost_price_per_kg != null ? `${ngn(Number(r.avg_cost_price_per_kg))}/kg` : "—"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {Number(r.total_weight_kg).toFixed(3)} kg · {ngn(Number(r.total_cost_price))} · {formatTimestamp(r.created_at as string)}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                    {items.map((it, i) => {
                      const lot = g1<{ weight_kg: number; cost_price_per_kg: number | null; material: unknown; supplier: unknown }>(
                        (it as { stock_lot: unknown }).stock_lot,
                      );
                      const mat = g1<{ name: string }>(lot?.material ?? null);
                      const sup = g1<{ name: string }>(lot?.supplier ?? null);
                      return (
                        <li key={i}>
                          {mat?.name ?? "—"} · {sup?.name ?? "—"} · {Number(lot?.weight_kg ?? 0).toFixed(3)} kg @{" "}
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
