import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { ApprovalChain } from "@/components/visits/ApprovalChain";
import { STATE_LABELS, type VisitState } from "@/lib/visits/state-machine";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);

// Shared "Live workflow — supply pipeline" panel shown on every role's home.
// Lists the most recent visits the viewer is allowed to see (RLS-scoped) with
// their stage chain, so everyone sees where work stands.
export async function LiveWorkflow({ limit = 6 }: { limit?: number }) {
  const supabase = await createClient();
  const { data: visits } = await supabase
    .from("visits")
    .select(`
      id, state, entry_path, created_at,
      supplier:suppliers(name),
      declared_material_type:material_types(name),
      site:sites(name)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Which of these visits have an owner-finalised price (drives the green
  // "Director OK" node in the chain).
  const visitIds = (visits ?? []).map((v) => v.id as string);
  const { data: finalized } = visitIds.length
    ? await supabase.from("visit_materials").select("visit_id").in("visit_id", visitIds).eq("price_finalized", true)
    : { data: [] as { visit_id: string }[] };
  const priceApprovedSet = new Set((finalized ?? []).map((r) => r.visit_id as string));

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Live workflow — supply pipeline</h2>
        <span className="mono hidden text-[11px] text-ink-2 sm:block">
          Processing · Receiving · Analysis · Pricing · Accounting · Stocked
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {(visits?.length ?? 0) === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-2">No visits yet.</p>
        ) : (
          <ul>
            {(visits ?? []).map((v) => {
              const supplier = g1<{ name: string }>(v.supplier);
              const material = g1<{ name: string }>(v.declared_material_type);
              const site = g1<{ name: string }>(v.site);
              const state = v.state as VisitState;
              return (
                <li key={v.id as string} className="border-b-[1.5px] border-line px-4 py-3 last:border-b-0">
                  <Link href={`/visits/${v.id}`} className="block">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Stamp>{(v.id as string).slice(0, 8).toUpperCase()}</Stamp>
                        <strong className="text-ink">{supplier?.name ?? "—"}</strong>
                        <span className="text-ink-2">
                          · {material?.name ?? "—"} · {site?.name ?? "—"}
                        </span>
                      </div>
                      <Badge variant={stateVariant(state)}>{STATE_LABELS[state] ?? state}</Badge>
                    </div>
                    <div className="mt-2">
                      <ApprovalChain
                        state={state}
                        entryPath={v.entry_path as "unprocessed" | "processed"}
                        priceApproved={priceApprovedSet.has(v.id as string)}
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
