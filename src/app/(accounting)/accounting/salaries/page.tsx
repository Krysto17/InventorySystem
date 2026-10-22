import { SalaryDesk } from "@/components/finance/SalaryDesk";

export const dynamic = "force-dynamic";

export default async function AccountingSalariesPage() {
  return <SalaryDesk backHref="/accounting" backLabel="Settlements" />;
}
