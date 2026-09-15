import { CostPriceModule } from "@/components/reports/CostPriceModule";
import { requireCostPriceUser } from "@/lib/auth/require-cost-price";

// The same cost-price / mixing-batch tool the general manager uses. Stock is
// the inventory employee's lane: since 0154 they see and mix lots from EVERY
// site, while the batch itself is still formed on their own site, and the owner
// still approves before a batch sells (0149).
export default async function InventoryCostPricePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCostPriceUser();
  return <CostPriceModule backHref="/inventory" backLabel="← Stock" searchParams={searchParams} />;
}
