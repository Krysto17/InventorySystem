import { getProfile } from "@/lib/auth/get-profile";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SampleForm } from "@/components/qc/SampleForm";
import { SampleAnalysesTable } from "@/components/qc/SampleAnalysesTable";
import { fetchSamples } from "@/lib/analyses/samples";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export default async function QcSamplesPage() {
  const me = await getProfile();
  if (!me || (me.role !== "qc" && me.role !== "owner")) redirect("/login");

  const supabase = await createClient();
  const [{ data: materialTypes }, samples] = await Promise.all([
    supabase.from("material_types").select("id, name").order("name"),
    fetchSamples(),
  ]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Sample analyses</h1>
        <p className="text-sm text-gray-500">
          Analyse a walk-in sample — no visit needed. Owner/GM attach the price.
        </p>
      </header>

      <SampleForm materialTypes={(materialTypes ?? []) as { id: string; name: string }[]} />

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Recorded samples</h2></CardHeader>
        <CardContent><SampleAnalysesTable rows={samples} canDelete /></CardContent>
      </Card>
    </main>
  );
}
