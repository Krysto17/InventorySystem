import { createClient } from "@/lib/supabase/server";
import { LiveWorkflowList, type WorkflowRow } from "@/components/visits/LiveWorkflowList";
import type { VisitState } from "@/lib/visits/state-machine";

import { one as g1 } from "@/lib/db/relation";

// Shared "Live workflow — supply pipeline" panel shown on every role's home.
// Lists the visits the viewer is allowed to see (RLS-scoped); the client list
// handles search/sort and collapsing to 10 rows (#6/#7).
export async function LiveWorkflow({ limit = 100 }: { limit?: number }) {
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

  // Which of these visits have an owner-finalised price (green "Director OK"),
  // and which have any withdrawn/unsettled line (marked "Unsettled", #3).
  const visitIds = (visits ?? []).map((v) => v.id as string);
  const [{ data: finalized }, { data: unsettled }] = visitIds.length
    ? await Promise.all([
        supabase.from("visit_materials").select("visit_id").in("visit_id", visitIds).eq("price_finalized", true),
        supabase.from("visit_materials").select("visit_id").in("visit_id", visitIds).eq("settlement_status", "unsettled"),
      ])
    : [{ data: [] as { visit_id: string }[] }, { data: [] as { visit_id: string }[] }];
  const priceApprovedSet = new Set((finalized ?? []).map((r) => r.visit_id as string));
  const unsettledSet = new Set((unsettled ?? []).map((r) => r.visit_id as string));

  const rows: WorkflowRow[] = (visits ?? []).map((v) => ({
    id: v.id as string,
    supplier: g1<{ name: string }>(v.supplier)?.name ?? "—",
    material: g1<{ name: string }>(v.declared_material_type)?.name ?? "—",
    site: g1<{ name: string }>(v.site)?.name ?? "—",
    state: v.state as VisitState,
    entryPath: v.entry_path as "unprocessed" | "processed",
    priceApproved: priceApprovedSet.has(v.id as string),
    unsettled: unsettledSet.has(v.id as string),
    date: v.created_at as string,
  }));

  return <LiveWorkflowList rows={rows} />;
}
