import { createClient } from "@/lib/supabase/server";
import { one as g1 } from "@/lib/db/relation";
import type { SampleRow } from "@/components/qc/SampleAnalysesTable";

// Sample analyses visible to the viewer (RLS: QC/manager own site; owner + GM
// all). Newest first.
export async function fetchSamples(): Promise<SampleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sample_analyses")
    .select(`
      id, created_at, supplier_name, weight_kg, result, price,
      material:material_types(name),
      site:sites(name)
    `)
    .order("created_at", { ascending: false });

  return (data ?? []).map((s) => ({
    id: s.id as string,
    date: s.created_at as string,
    supplier: (s.supplier_name as string) ?? "—",
    site: (g1((s as { site: unknown }).site) as { name?: string } | null)?.name ?? "—",
    material: (g1((s as { material: unknown }).material) as { name?: string } | null)?.name ?? "—",
    weight: s.weight_kg != null ? Number(s.weight_kg) : null,
    result: (s.result as string | null) ?? null,
    price: s.price != null ? Number(s.price) : null,
  }));
}
