import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { notFound } from "next/navigation";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { one as get1 } from "@/lib/db/relation";
import { AnalysesSheet, type AnalysisRow } from "@/components/qc/AnalysesSheet";

// #9: a sortable sheet of every XRF analysis this QC analyst has recorded.
export default async function QcAnalysesPage() {
  const me = await getProfile();
  if (!me || (me.role !== "qc" && me.role !== "owner")) notFound();
  const supabase = await createClient();

  const { data } = await supabase
    .from("xrf_records")
    .select(`
      id, result, weight_kg, mismatch, submitted, created_at, updated_at,
      visit_material:visit_materials!inner(
        material_type:material_types(name),
        visit:visits(id, supplier:suppliers(name))
      )
    `)
    .eq("recorded_by", me.id)
    .order("created_at", { ascending: false });

  const rows: AnalysisRow[] = (data ?? []).map((x) => {
    const vm = get1((x as { visit_material: unknown }).visit_material) as {
      material_type?: unknown;
      visit?: unknown;
    } | null;
    const material = (get1(vm?.material_type) as { name?: string } | null)?.name ?? "—";
    const visit = get1(vm?.visit) as { id?: string; supplier?: unknown } | null;
    const supplier = (get1(visit?.supplier) as { name?: string } | null)?.name ?? "—";
    return {
      id: x.id as string,
      visitId: (visit?.id as string) ?? "",
      date: (x.updated_at as string) ?? (x.created_at as string),
      supplier,
      material,
      result: (x.result as string | null) ?? null,
      qcWeight: x.weight_kg != null ? Number(x.weight_kg) : null,
      mismatch: !!x.mismatch,
      submitted: !!x.submitted,
    };
  });

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">My analyses</h1>
        <p className="text-sm text-gray-500">
          {rows.length} XRF analysis{rows.length !== 1 ? "es" : ""} recorded
        </p>
      </header>
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-sm">Analysis history</h2>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <AnalysesSheet rows={rows} />
        </CardContent>
      </Card>
    </main>
  );
}
