import { createClient } from "@/lib/supabase/server";
import { one as g1 } from "@/lib/db/relation";

export type RawAnalysisRow = {
  lineId: string;
  visitId: string;
  date: string;
  supplier: string;
  site: string;
  material: string;
  result: string | null;
  qcWeight: number | null;
  unitPrice: number | null;
  state: string;
};

// All XRF analyses across sites (RLS lets owner + general manager read cross-site;
// site managers see their own site). Powers the owner/GM analyses table (#4).
export async function fetchAllAnalyses(): Promise<RawAnalysisRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("xrf_records")
    .select(`
      id, result, weight_kg, created_at, updated_at,
      visit_material:visit_materials!inner(
        id, unit_price,
        material_type:material_types(name),
        visit:visits!inner(id, state, created_at, supplier:suppliers(name), site:sites(name))
      )
    `)
    .order("created_at", { ascending: false });

  return (data ?? []).map((x) => {
    const vm = g1((x as { visit_material: unknown }).visit_material) as {
      id?: string; unit_price?: number | null; material_type?: unknown; visit?: unknown;
    } | null;
    const visit = g1(vm?.visit) as {
      id?: string; state?: string; created_at?: string; supplier?: unknown; site?: unknown;
    } | null;
    return {
      lineId: (vm?.id as string) ?? "",
      visitId: (visit?.id as string) ?? "",
      date: (x.updated_at as string) ?? (x.created_at as string),
      supplier: (g1(visit?.supplier) as { name?: string } | null)?.name ?? "—",
      site: (g1(visit?.site) as { name?: string } | null)?.name ?? "—",
      material: (g1(vm?.material_type) as { name?: string } | null)?.name ?? "—",
      result: (x.result as string | null) ?? null,
      qcWeight: x.weight_kg != null ? Number(x.weight_kg) : null,
      unitPrice: vm?.unit_price != null ? Number(vm.unit_price) : null,
      state: (visit?.state as string) ?? "",
    };
  });
}
