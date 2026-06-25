import Link from "next/link";
import { CrossSiteReports } from "@/components/reports/CrossSiteReports";
import { requireGeneralManager } from "@/lib/auth/require-general-manager";

export default async function ManagerReportsPage() {
  await requireGeneralManager();
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Pricing queue</Link>
        <h1 className="text-2xl font-bold">Cross-site reports</h1>
      </div>
      <CrossSiteReports />
    </main>
  );
}
