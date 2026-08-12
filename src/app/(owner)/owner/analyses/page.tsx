import { getProfile } from "@/lib/auth/get-profile";
import { redirect } from "next/navigation";
import { fetchAllAnalyses, AGREED_STATES } from "@/lib/analyses/all-analyses";
import { AllAnalysesTable, type AnalysisRow } from "@/components/analyses/AllAnalysesTable";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export default async function OwnerAnalysesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getProfile();
  if (!me || me.role !== "owner") redirect("/login");

  const q = String((await searchParams).q ?? "").trim();
  const raw = await fetchAllAnalyses({ q });
  // Owner may price a line in the pricing stage, and release material that is
  // out of spec or that no price was agreed on — which raises its gate pass.
  const rows: AnalysisRow[] = raw.map((r) => ({
    ...r,
    canPrice: r.state === "pricing" && r.settlementStatus !== "unsettled",
    canRelease: r.state === "pricing" && r.settlementStatus !== "unsettled",
    agreed: AGREED_STATES.includes(r.state),
  }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">XRF analyses</h1>
        <p className="text-sm text-gray-500">{rows.length} analyses across all sites — set price inline.</p>
      </header>
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">All analyses</h2></CardHeader>
        <CardContent><AllAnalysesTable rows={rows} isOwner query={q} basePath="/owner/analyses" /></CardContent>
      </Card>
    </main>
  );
}
