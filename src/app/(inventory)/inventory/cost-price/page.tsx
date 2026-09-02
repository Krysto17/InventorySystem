import { CostPriceModule } from "@/components/reports/CostPriceModule";
import { requireCostPriceUser } from "@/lib/auth/require-cost-price";

// The same cost-price / mixing-batch tool the general manager uses. Stock is
// the inventory employee's lane, so they compute the weighted cost price over
// their own site's lots; the owner still approves before a batch sells (0149).
export default async function InventoryCostPricePage() {
  await requireCostPriceUser();
  return <CostPriceModule backHref="/inventory" backLabel="← Stock" />;
}
