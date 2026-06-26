import "server-only";
import { createClient } from "@/lib/supabase/server";
import { VISIT_STATES, type VisitState } from "./state-machine";

export type VisitQueueRow = {
  id: string;
  created_at: string;
  entry_path: "unprocessed" | "processed";
  state: VisitState;
  supplier: { id: string; name: string; phone: string | null } | null;
  declared_material_type: { id: string; name: string } | null;
};

export async function listVisitsByState(states: VisitState[]): Promise<VisitQueueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, created_at, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name)
    `)
    .in("state", states)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as VisitQueueRow[];
}

// A role's "done" list (#14): visits (RLS-scoped to the viewer's site) that have
// moved PAST the role's queue state — i.e. the role's work on them is finished,
// so they leave the active queue and land here. `entryPath` narrows to the lane
// a role actually handles (processing only ever touches unprocessed visits).
export async function listVisitsDoneAfter(
  queueState: VisitState,
  opts: { entryPath?: "unprocessed" | "processed"; limit?: number } = {},
): Promise<VisitQueueRow[]> {
  const idx = VISIT_STATES.indexOf(queueState);
  const downstream = VISIT_STATES.filter((_, i) => i > idx);
  if (downstream.length === 0) return [];

  const supabase = await createClient();
  let q = supabase
    .from("visits")
    .select(`
      id, created_at, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name)
    `)
    .in("state", downstream)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 25);
  if (opts.entryPath) q = q.eq("entry_path", opts.entryPath);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as VisitQueueRow[];
}

// QC's done list specifically: only visits this analyst actually XRF'd (exempt
// batches that skipped QC must not appear). Driven by the analyst's xrf_records.
export async function listQcCompletedVisits(
  analystId: string,
  limit = 25,
): Promise<VisitQueueRow[]> {
  const supabase = await createClient();
  const { data: xrf, error: xErr } = await supabase
    .from("xrf_records")
    .select("visit_material:visit_materials!inner(visit_id)")
    .eq("recorded_by", analystId);
  if (xErr) throw xErr;
  const visitIds = Array.from(
    new Set(
      (xrf ?? [])
        .map((r) => {
          const vm = (r as { visit_material: unknown }).visit_material;
          const one = Array.isArray(vm) ? vm[0] : vm;
          return (one as { visit_id?: string } | null)?.visit_id;
        })
        .filter((v): v is string => !!v),
    ),
  );
  if (visitIds.length === 0) return [];

  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, created_at, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name)
    `)
    .in("id", visitIds)
    .neq("state", "in_qc")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as VisitQueueRow[];
}

export async function listVisitsByStateWithAnalysis(state: VisitState): Promise<
  (VisitQueueRow & { analysis: { grade: string | null; weight: number; purity: number | null } | null })[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, created_at, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name),
      analysis:analysis_records(grade, weight, purity)
    `)
    .eq("state", state)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const raw = r as unknown as VisitQueueRow & {
      analysis: { grade: string | null; weight: number; purity: number | null }[] | null;
    };
    return {
      ...raw,
      analysis: Array.isArray(raw.analysis) && raw.analysis.length > 0
        ? raw.analysis[0]
        : null,
    };
  });
}
