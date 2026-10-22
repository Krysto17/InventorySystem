import Link from "next/link";
import { ProfitLossPageBody } from "@/components/finance/ProfitLossPageBody";

// Money figures must never be served from cache — a stale profit figure is a
// wrong one that looks authoritative.
export const dynamic = "force-dynamic";

export default async function AccountingProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Settlements</Link>
        <h1 className="text-2xl font-bold">Profit &amp; loss</h1>
      </div>
      <ProfitLossPageBody basePath="/accounting/profit-loss" params={params} />
    </main>
  );
}
