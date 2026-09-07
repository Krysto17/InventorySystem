import { CostPriceModule } from "@/components/reports/CostPriceModule";
import { requireCostPriceUser } from "@/lib/auth/require-cost-price";

export default async function ManagerCostPricePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCostPriceUser();
  return <CostPriceModule backHref="/manager" backLabel="← Pricing queue" searchParams={searchParams} />;
}
