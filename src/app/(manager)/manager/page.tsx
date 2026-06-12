import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listVisitsByStateWithAnalysis } from "@/lib/visits/queries";
import { formatTimestamp, formatWeight } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const g1 = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null));

export default async function ManagerHomePage() {
  const queue = await listVisitsByStateWithAnalysis("pricing");

  // QC weight mismatches (auto-flagged when QC's weight differs >2% from
  // receiving's); the manager resolves one by correcting either weight.
  const supabase = await createClient();
  const { data: mismatches } = await supabase
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
    .limit(20);

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
