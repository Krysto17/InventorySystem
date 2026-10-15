import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";
import { PaymentBreakdown } from "@/components/payments/PaymentBreakdown";
import { fetchPaymentsBySettlement } from "@/lib/payments/breakdown";


// Financial figures must never be served from cache — a stale balance reads as
// "the payment did not register". Always render fresh.
export const dynamic = "force-dynamic";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Every supplier settlement this accountant has closed (marked paid). The
// general accountant sees the ones they closed across all sites.
export default async function AccountingClosedPage() {
  const me = await getProfile();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("batch_settlements")
    .select("id, visit_id, net_balance, paid_at, site:sites(name), visit:visits(supplier:suppliers(name))")
    .eq("status", "paid")
    .eq("paid_by", me?.id ?? "")
    .order("paid_at", { ascending: false });

  const closed = rows ?? [];
  const total = closed.reduce((s, r) => s + Number(r.net_balance), 0);

  // A closed settlement is exactly where "which account did this go into?" gets
  // asked — weeks later, when the supplier queries a payment. The total alone
  // cannot answer it for a payout that was split across several accounts.
  const paymentsBy = await fetchPaymentsBySettlement(supabase, closed.map((r) => r.id as string));

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Settlements</Link>
        <h1 className="text-2xl font-bold">Closed settlements</h1>
        <Badge variant={closed.length ? "green" : "default"}>{closed.length}</Badge>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Settlements you&rsquo;ve paid</h2>
            <span className="text-sm font-semibold">{ngn(total)} total</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {closed.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">You haven&rsquo;t closed any settlements yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {closed.map((r) => {
                const name = g1<{ name: string }>(g1<{ supplier: unknown }>((r as { visit: unknown }).visit)?.supplier)?.name ?? "—";
                const site = g1<{ name: string }>((r as { site: unknown }).site)?.name ?? "—";
                const parts = paymentsBy.get(r.id as string) ?? [];
                return (
                  <li key={r.id as string} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <Link href={`/visits/${r.visit_id}`} className="font-medium underline">{name}</Link>
                        <span className="text-ink-2"> · {site} · {ngn(Number(r.net_balance))}</span>
                      </span>
                      <span className="text-xs text-ink-2">Paid {r.paid_at ? formatTimestamp(r.paid_at as string) : "—"}</span>
                    </div>
                    {parts.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-ink-2 hover:underline">
                          {parts.length > 1
                            ? `Split across ${parts.length} payments — which account(s) it went into`
                            : "Which account it went into"}
                        </summary>
                        <div className="mt-1.5 rounded border border-line">
                          <PaymentBreakdown payments={parts} />
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
