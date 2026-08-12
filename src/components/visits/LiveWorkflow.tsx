import { createClient } from "@/lib/supabase/server";
import { LiveWorkflowList, type WorkflowRow } from "@/components/visits/LiveWorkflowList";
import type { VisitState } from "@/lib/visits/state-machine";

// Shared "Live workflow — supply pipeline" panel shown on every role's home.
// Lists the visits the viewer is allowed to see (RLS-scoped); the client list
// handles search/sort and collapsing to 10 rows (#6/#7).
//
// One read from visit_pipeline (0134) — this used to be three round-trips: the
// visits with three nested joins, then two more passes over visit_materials to
// work out the price/withdrawn flags.
export async function LiveWorkflow({ limit = 100 }: { limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("visit_pipeline")
    .select("id, state, entry_path, created_at, site_name, supplier_name, material_name, price_approved, unsettled_count")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows: WorkflowRow[] = (data ?? []).map((v) => ({
    id: v.id as string,
    supplier: (v.supplier_name as string) ?? "—",
    material: (v.material_name as string) ?? "—",
    site: (v.site_name as string) ?? "—",
    state: v.state as VisitState,
    entryPath: v.entry_path as "unprocessed" | "processed",
    priceApproved: Boolean(v.price_approved),
    unsettled: Number(v.unsettled_count ?? 0) > 0,
    unsettledCount: Number(v.unsettled_count ?? 0),
    date: v.created_at as string,
  }));

  return <LiveWorkflowList rows={rows} />;
}
