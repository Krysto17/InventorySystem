import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";

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
                return (
                  <li key={r.id as string} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      <Link href={`/visits/${r.visit_id}`} className="font-medium underline">{name}</Link>
                      <span className="text-ink-2"> · {site} · {ngn(Number(r.net_balance))}</span>
                    </span>
                    <span className="text-xs text-ink-2">Paid {r.paid_at ? formatTimestamp(r.paid_at as string) : "—"}</span>
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
