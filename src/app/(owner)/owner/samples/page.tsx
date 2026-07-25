import { getProfile } from "@/lib/auth/get-profile";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fetchSamples } from "@/lib/analyses/samples";
import { SampleAnalysesTable } from "@/components/qc/SampleAnalysesTable";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

// Sample analyses as their own module for the owner — walk-in samples analysed
// without a visit; the owner attaches the price and may remove unpriced rows.
export default async function OwnerSamplesPage() {
  const me = await getProfile();
  if (!me || me.role !== "owner") redirect("/login");

  const samples = await fetchSamples();

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Sample analyses</h1>
      </div>
      <p className="text-sm text-gray-500">
        {samples.length} sample{samples.length === 1 ? "" : "s"} across all sites — searchable by supplier, grouped per day. Set a price inline.
      </p>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Recorded samples</h2></CardHeader>
        <CardContent><SampleAnalysesTable rows={samples} canPrice canDelete /></CardContent>
      </Card>
    </main>
  );
}
