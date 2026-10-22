import { SalaryDesk } from "@/components/finance/SalaryDesk";

export const dynamic = "force-dynamic";

export default async function ManagerSalariesPage() {
  return <SalaryDesk backHref="/manager" backLabel="Pricing queue" />;
}
