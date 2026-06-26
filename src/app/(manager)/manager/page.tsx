import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVisitsByStateWithAnalysis } from "@/lib/visits/queries";
import { formatTimestamp, formatWeight } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";
import { approveBatch } from "@/app/visits/[id]/batch-actions";

import { one as g1 } from "@/lib/db/relation";

export default async function ManagerHomePage() {
  const supabase = await createClient();

  // Independent dashboard reads — run them in one round-trip (perf, #10).
  const [queue, { data: mismatches }, { data: approvalQueue }] = await Promise.all([
    listVisitsByStateWithAnalysis("pricing"),
    // QC weight mismatches (auto-flagged when QC's weight differs >2% from
    // receiving's); the manager resolves one by correcting either weight.
    supabase
      .from("xrf_records")
      .select(`
        id, weight_kg,
        line:visit_materials!inner(
          id, weight_kg,
          material:material_types(name),
          visit:visits!inner(id, state, supplier:suppliers(name))
        )
      `)
      .eq("mismatch", true)
      .limit(20),
    // #7/#12: batches submitted by receiving, awaiting this site manager's approval.
    supabase
      .from("visits")
      .select("id, created_at, supplier:suppliers(name), declared_material_type:material_types(name), site:sites(name)")
      .eq("state", "awaiting_manager")
      .order("created_at", { ascending: true }),
  ]);

  const openMismatches = (mismatches ?? []).filter((m) => {
    const line = g1<{ visit: unknown }>((m as { line: unknown }).line);
    const visit = g1<{ state: string }>(line?.visit ?? null);
    return visit && visit.state !== "exited" && visit.state !== "stocked";
  });

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Manager</h1>
        <p className="text-sm text-gray-500">{queue.length} visit{queue.length !== 1 ? "s" : ""} awaiting pricing</p>
      </header>

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Awaiting your approval</h2>
            <Badge variant={approvalQueue?.length ? "yellow" : "default"}>{approvalQueue?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(approvalQueue?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No batches awaiting approval.</p>
          ) : (
            <ul className="divide-y">
              {(approvalQueue ?? []).map((v) => {
                const sup = g1<{ name: string }>((v as { supplier: unknown }).supplier);
                const mat = g1<{ name: string }>((v as { declared_material_type: unknown }).declared_material_type);
                const site = g1<{ name: string }>((v as { site: unknown }).site);
                return (
                  <li key={v.id as string} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                    <Link href={`/visits/${v.id}`} className="flex-1 hover:underline">
                      <span className="font-medium">{sup?.name ?? "—"}</span>
                      <span className="text-gray-500"> · {mat?.name ?? "—"} · {site?.name ?? "—"} · {formatTimestamp(v.created_at as string)}</span>
                    </Link>
                    <div className="flex shrink-0 gap-2">
                      <form action={approveBatch}>
                        <input type="hidden" name="visit_id" value={v.id as string} />
                        <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve → analysis</button>
                      </form>
                      <form action={approveBatch}>
                        <input type="hidden" name="visit_id" value={v.id as string} />
                        <input type="hidden" name="skip_qc" value="true" />
                        <button type="submit" className="rounded border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50" title="Skip XRF analysis and go straight to pricing">Skip → pricing</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Pricing queue</h2>
            <Badge variant="purple">{queue.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {queue.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">Queue is empty.</p>
          ) : (
            <ul className="divide-y">
              {queue.map((v) => (
                <li key={v.id}>
                  <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <div>
                      <div className="font-medium text-sm">{v.supplier?.name ?? "—"}</div>
                      <div className="text-xs text-gray-500">
                        {v.declared_material_type?.name ?? "—"} · {formatTimestamp(v.created_at)}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div>Grade: <strong>{v.analysis?.grade ?? "—"}</strong></div>
                      <div className="text-xs text-gray-500">{v.analysis ? formatWeight(v.analysis.weight) : "—"}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">QC weight mismatches</h2>
            <Badge variant={openMismatches.length > 0 ? "red" : "default"}>{openMismatches.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {openMismatches.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No flagged mismatches.</p>
          ) : (
            <ul className="divide-y">
              {openMismatches.map((m) => {
                const line = g1<{
                  id: string; weight_kg: number; material: unknown; visit: unknown;
                }>((m as { line: unknown }).line);
                const mat = g1<{ name: string }>(line?.material ?? null);
                const visit = g1<{ id: string; supplier: unknown }>(line?.visit ?? null);
                const sup = g1<{ name: string }>(visit?.supplier ?? null);
                return (
                  <li key={m.id as string}>
                    <Link href={`/visits/${visit?.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                      <div className="text-sm">
                        <span className="font-medium">{mat?.name ?? "—"}</span> · {sup?.name ?? "—"}
                      </div>
                      <div className="text-right text-xs text-red-700">
                        receiving {Number(line?.weight_kg ?? 0).toFixed(3)} kg ≠ QC {Number(m.weight_kg).toFixed(3)} kg
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
