import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { VisitState } from "./state-machine";

export type VisitQueueRow = {
  id: string;
  created_at: string;
  vehicle_plate: string | null;
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
      id, created_at, vehicle_plate, entry_path, state,
      supplier:suppliers(id, name, phone),
      declared_material_type:material_types(id, name)
    `)
    .in("state", states)
    .order("created_at", { ascending: true });
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
      id, created_at, vehicle_plate, entry_path, state,
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
