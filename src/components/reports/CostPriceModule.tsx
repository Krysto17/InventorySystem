import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { MixingBatchTool, type Lot } from "@/components/reports/MixingBatchTool";
import { deleteCostPriceRun } from "@/app/(manager)/manager/cost-price/actions";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ActionForm } from "@/components/ui/ActionForm";
import { CostRunEditor, type RunLot, type RunExtra } from "@/components/reports/CostRunEditor";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// How many lots the picker shows before asking to be expanded.
const PAGE_SIZE = 300;
// PostgREST refuses to return more than 1,000 rows per request, so asking for
// more silently returns 1,000 and the screen would lie about what it is showing.
const MAX_ROWS = 1000;

// The cost-price / mixing-batch screen, shared by the general manager
// (/manager/cost-price) and the inventory employee (/inventory/cost-price).
// Both see the same tool; RLS decides which lots and runs come back.
export async function CostPriceModule({
  backHref, backLabel, searchParams,
}: {
  backHref: string; backLabel: string;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  const requested = Number(String((await searchParams)?.lots ?? "")) || PAGE_SIZE;
  const limit = Math.min(Math.max(requested, PAGE_SIZE), MAX_ROWS);

  const [{ data: lotsRaw, error: lotsError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from("stock_lots")
      .select(`
        id, weight_kg, cost_price_per_kg, material_type_id,
        material:material_types(name), supplier:suppliers(name), site:sites(name),
        line:visit_materials!stock_lots_ref_visit_material_id_fkey(magnetic_analysis)
      `)
      .eq("status", "available")
      // NEWEST first. A lot exists only because its settlement was paid, so the
      // newest lot is the most recently paid material — the one the operator
      // came here to mix. Ordering oldest-first and capping the list silently
      // dropped exactly those: measured in production at 483 available lots,
      // 183 of them unreachable. `id` breaks the tie, because a paid batch
      // writes all of its lots in one transaction and they share created_at.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      // One row more than we show. Whether it comes back is how we know there
      // are more, without a second count query over every lot.
      .limit(limit + 1),
    supabase
      .from("cost_price_runs")
      .select(`
        id, label, batch_code, sold, approval_status, total_weight_kg, total_cost_price, avg_cost_price_per_kg, created_at,
        material:material_types(name),
        items:cost_price_run_lots(
          stock_lot_id,
          stock_lot:stock_lots(weight_kg, cost_price_per_kg, material:material_types(name), supplier:suppliers(name))
        ),
        extras:cost_price_run_extras(id, material_name, weight_kg, cost_price_per_kg)
      `)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const rawLots = lotsRaw ?? [];
  // The extra row is a signal, never a displayed row.
  const hasMore = rawLots.length > limit;
  // A request can never return more than MAX_ROWS, so past that point there is
  // nothing further to ask for and "load more" would do nothing.
  const canLoadMore = hasMore && limit < MAX_ROWS;

  const lots: Lot[] = rawLots.slice(0, limit).map((l) => ({
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
        <Link href={backHref} className="text-sm text-gray-500 hover:underline">{backLabel}</Link>
        <h1 className="text-2xl font-bold">Cost price &amp; mixing batches</h1>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Form a mixing batch</h2>
          <p className="text-xs text-zinc-500">
            Pick available stock lots and/or add external (bought-outside) materials, then form a
            batch. Selling removes the stocked lots and records the weighted cost price; external
            materials only count toward the cost.
          </p>
        </CardHeader>
        <CardContent>
          {/* A failed read used to render as "no stock lots available", which
              reads as a fact about the stock rather than a broken page. */}
          {lotsError ? (
            <p className="mb-3 text-sm text-red-600">
              Couldn&apos;t load the stock lots — this is not the same as having none. Reload the
              page, and tell the owner if it keeps happening.
            </p>
          ) : lots.length === 0 ? (
            <p className="mb-3 text-sm text-zinc-500">No stock lots available — you can still add external materials below.</p>
          ) : null}
          {hasMore && (
            <p className="mb-3 text-sm text-amber-700">
              Showing the {lots.length} most recently paid lots.{" "}
              {canLoadMore ? (
                <Link
                  href={`?lots=${Math.min(limit + PAGE_SIZE, MAX_ROWS)}`}
                  className="font-medium underline"
                >
                  Load more
                </Link>
              ) : (
                <>That is the most this screen can list at once — mix these first, or narrow the search.</>
              )}
            </p>
          )}
          <MixingBatchTool lots={lots} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Recent batches ({runs?.length ?? 0})</h2></CardHeader>
        <CardContent className="p-0">
          {runsError ? (
            <p className="px-4 py-3 text-sm text-red-600">
              Couldn&apos;t load the batches — reload the page rather than re-forming a batch.
            </p>
          ) : (runs?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-500">No batches yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase text-ink-2">
                    <th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2 text-right">Weight</th>
                    <th className="px-3 py-2 text-right">Total cost</th>
                    <th className="px-3 py-2 text-right">Avg ₦/kg</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(runs ?? []).map((r) => {
                    const items = (r as { items: unknown[] }).items ?? [];
                    const runMat = g1<{ name: string }>((r as { material: unknown }).material);
                    const st = r.approval_status as string | null;
                    const badge = st === "approved" ? <Badge variant="paid">Sold</Badge>
                      : st === "pending" ? <Badge variant="yellow">Awaiting owner</Badge>
                      : st === "rejected" ? <Badge variant="red">Rejected</Badge>
                      : <Badge variant="default">Computation</Badge>;
                    return (
                      <tr key={r.id as string} className="border-b border-line/60 align-top">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {r.batch_code != null && <Stamp>{r.batch_code as string}</Stamp>}
                            <span className="font-medium">{r.label as string}</span>
                          </div>
                          {items.length > 0 && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] text-ink-2 hover:underline">{items.length} lot{items.length === 1 ? "" : "s"}</summary>
                              <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                                {items.map((it, i) => {
                                  const lot = g1<{ weight_kg: number; cost_price_per_kg: number | null; material: unknown; supplier: unknown }>((it as { stock_lot: unknown }).stock_lot);
                                  const mat = g1<{ name: string }>(lot?.material ?? null);
                                  const sup = g1<{ name: string }>(lot?.supplier ?? null);
                                  return (
                                    <li key={i}>{mat?.name ?? "—"} · {sup?.name ?? "—"} · {Number(lot?.weight_kg ?? 0).toFixed(3)} kg @ {lot?.cost_price_per_kg != null ? `${ngn(Number(lot.cost_price_per_kg))}/kg` : "—"}</li>
                                  );
                                })}
                              </ul>
                            </details>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <a href={`/api/pdf/cost-price/${r.id}`} target="_blank" rel="noreferrer"
                              className="rounded border border-line px-2 py-0.5 text-[11px] hover:bg-paper">🖨 Print</a>
                            {st !== "approved" && (
                              <ActionForm action={deleteCostPriceRun} data-confirm="Delete this cost-price computation?">
                                <input type="hidden" name="run_id" value={r.id as string} />
                                <SubmitButton pendingText="Deleting…" className="rounded border border-red-300 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-50">Delete</SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                          {st !== "approved" && (
                            <CostRunEditor
                              runId={r.id as string}
                              label={r.label as string}
                              lots={items.map((it) => {
                                const lot = g1<{ weight_kg: number; cost_price_per_kg: number | null; material: unknown; supplier: unknown }>((it as { stock_lot: unknown }).stock_lot);
                                return {
                                  stockLotId: (it as { stock_lot_id: string }).stock_lot_id,
                                  material: g1<{ name: string }>(lot?.material ?? null)?.name ?? "—",
                                  supplier: g1<{ name: string }>(lot?.supplier ?? null)?.name ?? null,
                                  weight: Number(lot?.weight_kg ?? 0),
                                  cost: lot?.cost_price_per_kg != null ? Number(lot.cost_price_per_kg) : null,
                                } satisfies RunLot;
                              })}
                              extras={(((r as { extras: unknown }).extras ?? []) as Record<string, unknown>[]).map((e) => ({
                                id: e.id as string,
                                name: e.material_name as string,
                                weight: Number(e.weight_kg),
                                cost: Number(e.cost_price_per_kg),
                              } satisfies RunExtra))}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 text-ore">{runMat?.name ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.total_weight_kg).toFixed(3)} kg</td>
                        <td className="px-3 py-2 text-right tabular-nums">{ngn(Number(r.total_cost_price))}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.avg_cost_price_per_kg != null ? ngn(Number(r.avg_cost_price_per_kg)) : "—"}</td>
                        <td className="px-3 py-2">{badge}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-2">{formatTimestamp(r.created_at as string)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
