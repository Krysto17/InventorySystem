import { CostPriceModule } from "@/components/reports/CostPriceModule";
import { requireCostPriceUser } from "@/lib/auth/require-cost-price";

export default async function ManagerCostPricePage() {
  await requireCostPriceUser();
  return <CostPriceModule backHref="/manager" backLabel="← Pricing queue" />;
}
