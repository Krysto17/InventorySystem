import { one as g1 } from "@/lib/db/relation";
import type { PaymentRow } from "@/components/payments/PaymentBreakdown";
import type { createClient } from "@/lib/supabase/server";

// The server client as the callers already hold it. Spelling the shape out
// structurally instead sent tsc into an excessively-deep instantiation against
// PostgREST's generic builder types.
type ServerClient = Awaited<ReturnType<typeof createClient>>;

// The columns a payment breakdown needs: the amount, how it was sent, and the
// account it landed in. `paid_by` is resolved to a name so the row can say who
// counted the money out.
const PAYMENT_COLUMNS = `
  id, settlement_id, amount, method, note, created_at,
  account_name, account_number, bank_name,
  payer:profiles!settlement_payments_paid_by_fkey(full_name)
`;

/**
 * Every payment made against each of `settlementIds`, grouped by settlement.
 *
 * A supplier payout is frequently split — part by transfer to the supplier's
 * bank, part in cash from the safe, part to an account the supplier nominated.
 * The settlement row records only the total, so the question "which account
 * received what" can only be answered from `settlement_payments`, and it is
 * asked most often *after* the settlement is closed, when a supplier queries a
 * payment weeks later.
 *
 * Five screens need the same rows in the same shape, so the query lives here
 * rather than being re-spelled on each one. RLS still decides what comes back:
 * this adds no reach, it just stops the column list drifting between screens.
 */
export async function fetchPaymentsBySettlement(
  supabase: ServerClient,
  settlementIds: string[],
): Promise<Map<string, PaymentRow[]>> {
  const by = new Map<string, PaymentRow[]>();
  if (settlementIds.length === 0) return by;

  const { data } = await supabase
    .from("settlement_payments")
    .select(PAYMENT_COLUMNS)
    .in("settlement_id", settlementIds)
    .order("created_at", { ascending: true });

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const sid = row.settlement_id as string;
    by.set(sid, [...(by.get(sid) ?? []), {
      id: row.id as string,
      amount: Number(row.amount),
      method: (row.method as string | null) ?? null,
      note: (row.note as string | null) ?? null,
      created_at: (row.created_at as string | null) ?? null,
      account_name: (row.account_name as string | null) ?? null,
      account_number: (row.account_number as string | null) ?? null,
      bank_name: (row.bank_name as string | null) ?? null,
      payer_name: g1<{ full_name?: string }>(row.payer)?.full_name ?? null,
    }]);
  }
  return by;
}
