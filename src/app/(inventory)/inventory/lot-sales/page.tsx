import { redirect } from "next/navigation";

// Lot sales were retired: Cost Price is the one workflow for selling stock.
// It sells the same stock lots, takes a row lock while doing it, and records the
// `mixed_batch` movement the old path never wrote — every one of the 695 lots
// sold in production went through it, and this screen never completed a sale.
//
// The route stays as a redirect rather than a 404 so an operator's bookmark
// still lands somewhere useful.
export default function RetiredLotSalesPage() {
  redirect("/inventory/cost-price");
}
