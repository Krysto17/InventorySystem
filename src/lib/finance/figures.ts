import { createClient } from "@/lib/supabase/server";

// ─── Canonical money figures ────────────────────────────────────────────────
// Every module (approvals, ledger, finance breakdown, reports) must report the
// SAME numbers, so the definitions live here once. Previously each page rolled
// its own and they disagreed.
//
//   ADVANCES
//     paid out    = advances with approval_status 'paid' (money actually left)
//     recovered   = advance_deductions of kind 'advance'
//     outstanding = paid out − recovered  ← what suppliers still owe
//   Processing/light-bill recoveries are a SEPARATE balance and never touch it.
//
//   PROCESSING FEES (light bills)
//     collected = netted off a settlement that was actually PAID
//               + paid in cash at a dressing-only close (bill not carried)
//               + a carried bill later recovered (kind 'processing')
//     logged    = every light bill ever recorded (incl. never collected)

export const ADVANCE_PAID_STATUS = "paid";
export const ADVANCE_RECOVERY_KIND = "advance";
export const PROCESSING_RECOVERY_KIND = "processing";

export type FinanceFigures = {
  advancesPaidOut: number;
  advancesRecovered: number;
  advancesOutstanding: number;
  feesNetted: number;
  feesCash: number;
  feesRecovered: number;
  feesCollected: number;
  feesLogged: number;
};

const sum = (rows: Array<Record<string, unknown>> | null, key: string) =>
  (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);

// All figures in one round-trip. RLS scopes the rows to what the viewer may see,
// so a site manager gets their site's numbers and the owner gets everything.
export async function fetchFinanceFigures(): Promise<FinanceFigures> {
  const supabase = await createClient();
  const [
    { data: paidAdvances },
    { data: advanceRecoveries },
    { data: paidSettlementFees },
    { data: cashFees },
    { data: processingRecoveries },
    { data: loggedFees },
  ] = await Promise.all([
    supabase.from("advances").select("amount_naira").eq("approval_status", ADVANCE_PAID_STATUS),
    supabase.from("advance_deductions").select("amount").eq("kind", ADVANCE_RECOVERY_KIND),
    supabase.from("batch_settlements").select("light_bill_total").eq("status", "paid"),
    supabase.from("utility_charges").select("amount, visit:visits!inner(dressing_only)")
      .eq("kind", "light_bill").eq("carried", false).eq("visits.dressing_only", true),
    supabase.from("advance_deductions").select("amount").eq("kind", PROCESSING_RECOVERY_KIND),
    supabase.from("utility_charges").select("amount").eq("kind", "light_bill"),
  ]);

  const advancesPaidOut = sum(paidAdvances, "amount_naira");
  const advancesRecovered = sum(advanceRecoveries, "amount");
  const feesNetted = sum(paidSettlementFees, "light_bill_total");
  const feesCash = sum(cashFees, "amount");
  const feesRecovered = sum(processingRecoveries, "amount");

  return {
    advancesPaidOut,
    advancesRecovered,
    advancesOutstanding: Math.max(advancesPaidOut - advancesRecovered, 0),
    feesNetted,
    feesCash,
    feesRecovered,
    feesCollected: feesNetted + feesCash + feesRecovered,
    feesLogged: sum(loggedFees, "amount"),
  };
}
