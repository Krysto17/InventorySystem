import { redirect } from "next/navigation";

// Bulk sales were retired: Cost Price is the one workflow for selling stock.
// The old path sold pooled weight by grade without touching stock_lots, so the
// same material could be bulk-sold and then sold again as a lot; it never
// completed a sale in production. Selling now goes through Cost Price, which
// sells identified lots under a row lock.
//
// The route stays as a redirect rather than a 404 so an operator's bookmark
// still lands somewhere useful.
export default function RetiredBulkSalesPage() {
  redirect("/inventory/cost-price");
}
