import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { RecordPaymentForm } from "@/components/visits/RecordPaymentForm";
import { one as g1 } from "@/lib/db/relation";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Money must never be served from cache — a stale balance reads as "the payment
// did not register".
export const dynamic = "force-dynamic";

// The cash desk. Part payments to a supplier are handed over as physical cash by
// the inventory employee; this is the queue of payouts the manager priced and
// the OWNER approved, with what is still owed on each. Recording here only logs
// cash that has actually changed hands — it approves nothing.
export default async function InventoryCashPayoutsPage() {
  const me = await getProfile();
  if (!me || !["inventory", "owner"].includes(me.role)) redirect(me ? ROLE_HOME[me.role] : "/login");
  const supabase = await createClient();

  const { data: settlements } = await supabase
    .from("batch_settlements")
    .select(`
      id, visit_id, net_balance, status, approved_at,
      visit:visits(supplier:suppliers(name)),
      site:sites(name)
    `)
    .in("status", ["approved", "partially_paid"])
    .order("approved_at", { ascending: true });

  const ids = (settlements ?? []).map((s) => s.id as string);
  const { data: payments } = ids.length
    ? await supabase
        .from("settlement_payments")
        .select("id, settlement_id, amount, method, note, created_at, payer:profiles!settlement_payments_paid_by_fkey(full_name)")
        .in("settlement_id", ids)
        .order("created_at", { ascending: true })
    : { data: [] as Record<string, unknown>[] };

  const paidBy = new Map<string, number>();
  for (const p of payments ?? []) {
    const key = p.settlement_id as string;
    paidBy.set(key, (paidBy.get(key) ?? 0) + Number(p.amount));
  }

  const rows = (settlements ?? []).map((s) => {
    const net = Number(s.net_balance);
    const paid = paidBy.get(s.id as string) ?? 0;
    return {
      id: s.id as string,
      visitId: s.visit_id as string,
      supplier: g1<{ name: string }>(g1<{ supplier: unknown }>((s as { visit: unknown }).visit)?.supplier)?.name ?? "—",
      site: g1<{ name: string }>((s as { site: unknown }).site)?.name ?? "—",
      status: s.status as string,
      approvedAt: s.approved_at as string | null,
      net, paid,
      remaining: Math.max(net - paid, 0),
      // Cash already counted out on this payout, so the desk can see its own trail.
      cash: (payments ?? [])
        .filter((p) => p.settlement_id === s.id && p.method === "cash")
        .map((p) => ({
          id: p.id as string,
          amount: Number(p.amount),
          note: (p.note as string | null) ?? null,
          at: p.created_at as string,
          by: g1<{ full_name?: string }>((p as { payer: unknown }).payer)?.full_name ?? "—",
        })),
    };
  });
  const open = rows.filter((r) => r.remaining > 0.005);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inventory" className="text-sm text-gray-500 hover:underline">← Stock</Link>
        <h1 className="text-2xl font-bold">Cash payouts</h1>
      </div>
      <p className="text-sm text-ink-2">
        Payouts the manager priced and the owner approved. Count out the cash, then record what
        you handed over — part payments are fine, and the balance stays open until it is cleared.
        Bank transfers are recorded by accounting, not here.
      </p>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Awaiting cash</h2>
            <Badge variant={open.length ? "blue" : "default"}>{open.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {open.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No approved payout is waiting on cash.</p>
          ) : (
            <ul className="divide-y divide-line">
              {open.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/visits/${r.visitId}`} className="font-medium underline">{r.supplier}</Link>
                        <span className="font-semibold">{ngn(r.remaining)} left</span>
                        {r.status === "partially_paid" && <Badge variant="blue">part-paid</Badge>}
                      </span>
                      <span className="block text-xs text-ink-2">
                        {r.site} · {ngn(r.paid)} of {ngn(r.net)} paid
                        {r.approvedAt ? ` · approved ${formatTimestamp(r.approvedAt)}` : ""}
                      </span>
                    </span>
                  </div>

                  {r.cash.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[11px] text-ink-2">
                      {r.cash.map((c) => (
                        <li key={c.id}>
                          Cash {ngn(c.amount)} · {c.by} · {formatTimestamp(c.at)}{c.note ? ` · “${c.note}”` : ""}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-1">
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-ink-2 hover:underline">Record cash issued</summary>
                      <RecordPaymentForm
                        visitId={r.visitId}
                        settlementId={r.id}
                        remaining={r.remaining}
                        cashOnly
                      />
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
