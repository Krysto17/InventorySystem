import { revalidatePath } from "next/cache";

// Every surface that displays a supplier's ADVANCE or PROCESSING debt. Any
// action that moves those balances must call this — otherwise the page keeps
// serving its cached figure and the balance looks like it never changed (the
// symptom: "advance marked paid isn't adding to the supplier's debt").
//
// The dynamic routes use the "page" type so every instance is revalidated, not
// just one id.
export function revalidateSupplierFinance() {
  revalidatePath("/suppliers/[id]", "page"); // supplier profile: both balances
  revalidatePath("/visits/[id]", "page");    // SupplierFinanceCard / settlement
  revalidatePath("/owner/ledger");           // per-supplier advance ledger
  revalidatePath("/owner/approvals");        // "Advances outstanding" figure
  revalidatePath("/owner/finance");          // finance breakdown
  revalidatePath("/manager/advances");
  revalidatePath("/owner/payments");
  revalidatePath("/manager/payments");
  revalidatePath("/accounting/payouts");
}
