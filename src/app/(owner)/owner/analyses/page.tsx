import { getProfile } from "@/lib/auth/get-profile";
import { redirect } from "next/navigation";
import { fetchAllAnalyses } from "@/lib/analyses/all-analyses";
import { fetchSamples } from "@/lib/analyses/samples";
import { AllAnalysesTable, type AnalysisRow } from "@/components/analyses/AllAnalysesTable";
import { SampleAnalysesTable } from "@/components/qc/SampleAnalysesTable";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export default async function OwnerAnalysesPage() {
  const me = await getProfile();
  if (!me || me.role !== "owner") redirect("/login");

  const [raw, samples] = await Promise.all([fetchAllAnalyses(), fetchSamples()]);
  // Owner may price any line that is in the pricing stage.
  const rows: AnalysisRow[] = raw.map((r) => ({ ...r, canPrice: r.state === "pricing" }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">XRF analyses</h1>
        <p className="text-sm text-gray-500">{rows.length} analyses across all sites — set price inline.</p>
      </header>
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">All analyses</h2></CardHeader>
        <CardContent><AllAnalysesTable rows={rows} /></CardContent>
      </Card>
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Sample analyses</h2></CardHeader>
        <CardContent><SampleAnalysesTable rows={samples} canPrice /></CardContent>
      </Card>
    </main>
  );
}
