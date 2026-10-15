import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { PayablesReview } from "@/components/payables/PayablesReview";
import { one as g1 } from "@/lib/db/relation";
import { PaymentBreakdown, type PaymentRow } from "@/components/payments/PaymentBreakdown";


// Financial figures must never be served from cache — a stale balance reads as
// "the payment did not register". Always render fresh.
export const dynamic = "force-dynamic";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Owner's payment console: every payable awaiting payment (hold / send back),
// what's on hold, items returned to the manager for correction, and the record
// of what's already been paid.
export default async function OwnerPaymentsPage() {
  const supabase = await createClient();
  const { data: paid } = await supabase
    .from("batch_settlements")
    .select("id, visit_id, net_balance, paid_at, site:sites(name), visit:visits(supplier:suppliers(name))")
    .eq("status", "paid").order("paid_at", { ascending: false }).limit(30);

  // A settled payout is often several payments into several accounts. The total
  // alone cannot answer "which account received what", which is the question
  // behind every payment query a supplier raises.
  const paidIds = (paid ?? []).map((p) => p.id as string);
  const { data: paymentRows } = paidIds.length
    ? await supabase.from("settlement_payments")
        .select(`
          id, settlement_id, amount, method, note, created_at,
          account_name, account_number, bank_name,
          payer:profiles!settlement_payments_paid_by_fkey(full_name)
        `)
        .in("settlement_id", paidIds)
        .order("created_at", { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };
  const paymentsBy = new Map<string, PaymentRow[]>();
  for (const p of paymentRows ?? []) {
    const sid = p.settlement_id as string;
    paymentsBy.set(sid, [...(paymentsBy.get(sid) ?? []), {
      id: p.id as string,
      amount: Number(p.amount),
      method: (p.method as string | null) ?? null,
      note: (p.note as string | null) ?? null,
      created_at: (p.created_at as string | null) ?? null,
      account_name: (p.account_name as string | null) ?? null,
      account_number: (p.account_number as string | null) ?? null,
      bank_name: (p.bank_name as string | null) ?? null,
      payer_name: g1<{ full_name?: string }>((p as { payer: unknown }).payer)?.full_name ?? null,
    }]);
  }

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Payments</h1>
      </div>

      <PayablesReview canManage includeApproved includeReturned />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recently paid (supplier settlements)</h2>
            <Badge variant={paid?.length ? "green" : "default"}>{paid?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(paid?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing paid yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(paid ?? []).map((p) => {
                const name = g1<{ name: string }>(g1<{ supplier: unknown }>((p as { visit: unknown }).visit)?.supplier)?.name ?? "—";
                const site = g1<{ name: string }>((p as { site: unknown }).site)?.name ?? "—";
                return (
                  <li key={p.id as string} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <Link href={`/visits/${p.visit_id}`} className="font-medium underline">{name}</Link>
                        <span className="text-ink-2"> · {site} · {ngn(Number(p.net_balance))}</span>
                      </span>
                      <span className="text-xs text-ink-2">Paid {p.paid_at ? formatTimestamp(p.paid_at as string) : "—"}</span>
                    </div>
                    {(paymentsBy.get(p.id as string)?.length ?? 0) > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-semibold text-ink-2 hover:underline">
                          Which account{paymentsBy.get(p.id as string)!.length > 1 ? "s" : ""} it went into
                        </summary>
                        <div className="mt-1 rounded border border-line">
                          <PaymentBreakdown payments={paymentsBy.get(p.id as string)!} />
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
