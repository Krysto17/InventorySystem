import Link from "next/link";
import { CostPriceTool } from "@/components/reports/CostPriceTool";

export default async function AccountingCostPricePage() {
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Settlements</Link>
        <h1 className="text-2xl font-bold">Cost-price dashboard</h1>
      </div>
      <CostPriceTool />
    </main>
  );
}
