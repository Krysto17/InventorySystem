import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { createCostPriceRun } from "@/app/(manager)/manager/cost-price/actions";

// Phase 11 (F): combine stock lots (mixed materials allowed) into a saved
// weighted cost-price computation. Selecting lots here does NOT sell them.

const g1 = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null));

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export async function CostPriceTool() {
  const supabase = await createClient();

  const [{ data: lots }, { data: runs }] = await Promise.all([
    supabase
      .from("stock_lots")
      .select("id, weight_kg, cost_price_per_kg, status, material:material_types(name), supplier:suppliers(name), site:sites(name)")
      .eq("status", "available")
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("cost_price_runs")
      .select(`
        id, label, batch_code, total_weight_kg, total_cost_price, avg_cost_price_per_kg, created_at,
        material:material_types(name),
        items:cost_price_run_lots(
          stock_lot:stock_lots(weight_kg, cost_price_per_kg, material:material_types(name), supplier:suppliers(name))
        )
      `)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">New cost-price computation</h2></CardHeader>
        <CardContent>
          {(lots?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No available stock lots to combine.</p>
          ) : (
            <form action={createCostPriceRun} className="space-y-3">
              <label className="block max-w-sm text-sm">
                Label
                <input type="text" name="label" required placeholder="e.g. Mixed monazite batch — June"
                  className="mt-1 block w-full rounded border px-2 py-1 text-sm" />
              </label>
              <div className="divide-y rounded border">
                {(lots ?? []).map((l) => {
                  const mat = g1<{ name: string }>((l as { material: unknown }).material);
                  const sup = g1<{ name: string }>((l as { supplier: unknown }).supplier);
                  const site = g1<{ name: string }>((l as { site: unknown }).site);
                  const w = Number(l.weight_kg);
                  const c = l.cost_price_per_kg != null ? Number(l.cost_price_per_kg) : 0;
                  return (
                    <label key={l.id as string} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <input type="checkbox" name="lot_ids" value={l.id as string} />
                      <span className="flex-1">
                        <span className="font-medium">{mat?.name ?? "—"}</span> · {sup?.name ?? "—"} · {site?.name ?? "—"}
                      </span>
                      <span className="text-zinc-500">{w.toFixed(3)} kg · {ngn(c)}/kg</span>
                    </label>
                  );
                })}
              </div>
              <button type="submit" className="rounded bg-black px-4 py-1.5 text-sm text-white">
                Compute & save
              </button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Saved computations ({runs?.length ?? 0})</h2></CardHeader>
        <CardContent className="space-y-4">
          {(runs?.length ?? 0) === 0 ? (
            <p className="text-sm text-zinc-500">No computations saved yet.</p>
          ) : (
            (runs ?? []).map((r) => {
              const items = ((r as { items: unknown[] }).items ?? []);
              const runMat = g1<{ name: string }>((r as { material: unknown }).material);
              return (
                <div key={r.id as string} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.batch_code != null && <Stamp>{r.batch_code as string}</Stamp>}
                      <span className="text-sm font-medium">{r.label as string}</span>
                      {runMat?.name && (
                        <span className="mono text-[11px] uppercase tracking-[0.05em] text-ore">{runMat.name}</span>
                      )}
                    </div>
                    <Badge variant="purple">
                      {r.avg_cost_price_per_kg != null ? `${ngn(Number(r.avg_cost_price_per_kg))}/kg` : "—"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    {Number(r.total_weight_kg).toFixed(3)} kg · {ngn(Number(r.total_cost_price))} ·{" "}
                    {formatTimestamp(r.created_at as string)}
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
    </div>
  );
}
