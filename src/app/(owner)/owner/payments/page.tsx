import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { PayablesReview } from "@/components/payables/PayablesReview";
import { one as g1 } from "@/lib/db/relation";

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
                  <li key={p.id as string} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      <Link href={`/visits/${p.visit_id}`} className="font-medium underline">{name}</Link>
                      <span className="text-ink-2"> · {site} · {ngn(Number(p.net_balance))}</span>
                    </span>
                    <span className="text-xs text-ink-2">Paid {p.paid_at ? formatTimestamp(p.paid_at as string) : "—"}</span>
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
