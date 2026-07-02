import { requireGeneralManager } from "@/lib/auth/require-general-manager";
import { getProfile } from "@/lib/auth/get-profile";
import { fetchAllAnalyses, AGREED_STATES } from "@/lib/analyses/all-analyses";
import { fetchSamples } from "@/lib/analyses/samples";
import { AllAnalysesTable, type AnalysisRow } from "@/components/analyses/AllAnalysesTable";
import { SampleAnalysesTable } from "@/components/qc/SampleAnalysesTable";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export default async function ManagerAnalysesPage() {
  await requireGeneralManager();
  const me = await getProfile();

  const [raw, samples] = await Promise.all([fetchAllAnalyses(), fetchSamples()]);
  // The GM may price lines at their own site (New-Site); other sites are read-only
  // here (cross-site writes belong to the owner).
  const rows: AnalysisRow[] = raw.map((r) => ({
    ...r,
    canPrice: r.state === "pricing" && r.settlementStatus !== "unsettled" && r.site === (me?.site_name ?? ""),
    agreed: AGREED_STATES.includes(r.state),
  }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">XRF analyses</h1>
        <p className="text-sm text-gray-500">
          {rows.length} analyses across all sites. You can price {me?.site_name ?? "your site"} lines here.
        </p>
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
