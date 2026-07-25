import Link from "next/link";
import { requireGeneralManager } from "@/lib/auth/require-general-manager";
import { fetchSamples } from "@/lib/analyses/samples";
import { SampleAnalysesTable } from "@/components/qc/SampleAnalysesTable";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

// Sample analyses as their own module for the general manager — walk-in samples
// analysed without a visit; the GM attaches the price.
export default async function ManagerSamplesPage() {
  await requireGeneralManager();
  const samples = await fetchSamples();

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Sample analyses</h1>
      </div>
      <p className="text-sm text-gray-500">
        {samples.length} sample{samples.length === 1 ? "" : "s"} — searchable by supplier, grouped per day. Set a price inline.
      </p>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Recorded samples</h2></CardHeader>
        <CardContent><SampleAnalysesTable rows={samples} canPrice /></CardContent>
      </Card>
    </main>
  );
}
