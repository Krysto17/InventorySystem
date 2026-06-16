import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Stamp } from "@/components/ui/stamp";

const g1 = <T,>(v: unknown): T | null =>
  Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null);
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default async function OwnerLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const supabase = await createClient();

  const [{ data: suppliers }, { data: advances }, { data: deductions }, { data: lightBills }, { data: consumables }] =
    await Promise.all([
      supabase.from("suppliers").select("id, name, supplier_code"),
      supabase.from("advances").select("supplier_id, amount_naira, approval_status"),
      supabase.from("advance_deductions").select("supplier_id, amount"),
      supabase.from("utility_charges").select("amount, kind, visit:visits!inner(site:sites(name))").eq("kind", "light_bill"),
      supabase.from("consumables").select("amount_naira, site:sites(name)"),
    ]);

  // ── Advance ledger per supplier ──────────────────────────────────────────
  const given = new Map<string, number>();   // approved + paid advances
  const recovered = new Map<string, number>(); // deductions
  for (const a of advances ?? []) {
    if (a.approval_status === "approved" || a.approval_status === "paid") {
      given.set(a.supplier_id as string, (given.get(a.supplier_id as string) ?? 0) + Number(a.amount_naira));
    }
  }
  for (const d of deductions ?? []) {
    recovered.set(d.supplier_id as string, (recovered.get(d.supplier_id as string) ?? 0) + Number(d.amount));
  }
  const ledger = (suppliers ?? [])
    .map((s) => {
      const out = given.get(s.id as string) ?? 0;
      const rec = recovered.get(s.id as string) ?? 0;
      return { id: s.id as string, name: s.name as string, code: s.supplier_code as string | null, out, rec, outstanding: out - rec };
    })
    .filter((r) => r.out > 0 || r.rec > 0)
    .filter((r) => !query || r.name.toLowerCase().includes(query) || (r.code ?? "").toLowerCase().includes(query))
    .sort((a, b) => b.outstanding - a.outstanding);

  // ── Light bills per site ─────────────────────────────────────────────────
  const lightBySite = new Map<string, number>();
  for (const lb of lightBills ?? []) {
    const site = g1<{ name: string }>(g1<{ site: unknown }>((lb as { visit: unknown }).visit)?.site)?.name ?? "—";
    lightBySite.set(site, (lightBySite.get(site) ?? 0) + Number(lb.amount));
  }

  // ── Consumables per site ─────────────────────────────────────────────────
  const consBySite = new Map<string, { count: number; total: number }>();
  for (const c of consumables ?? []) {
    const site = g1<{ name: string }>((c as { site: unknown }).site)?.name ?? "—";
    const cur = consBySite.get(site) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(c.amount_naira ?? 0);
    consBySite.set(site, cur);
  }

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Advance ledger &amp; site finance</h1>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Advance ledger</h2></CardHeader>
        <CardContent className="space-y-3">
          <form method="GET" action="/owner/ledger" className="flex gap-2">
            <input name="q" defaultValue={q ?? ""} placeholder="Search supplier name or code…"
              className="flex-1 rounded border px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded bg-ink px-4 py-1.5 text-sm font-semibold text-white">Search</button>
          </form>
          {ledger.length === 0 ? (
            <p className="text-sm text-ink-2">No advances match.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-2">
                <tr>
                  <th className="py-1">Supplier</th>
                  <th className="py-1 text-right">Given out</th>
                  <th className="py-1 text-right">Recovered</th>
                  <th className="py-1 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1.5">
                      <Link href={`/owner/suppliers/${r.id}`} className="font-medium underline">{r.name}</Link>
                      {r.code && <span className="ml-2"><Stamp>{r.code}</Stamp></span>}
                    </td>
                    <td className="py-1.5 text-right">{ngn(r.out)}</td>
                    <td className="py-1.5 text-right">{ngn(r.rec)}</td>
                    <td className="py-1.5 text-right font-semibold">{ngn(r.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Light bills per site</h2></CardHeader>
          <CardContent className="p-0">
            {lightBySite.size === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-2">No light bills.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {[...lightBySite.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([site, total]) => (
                  <li key={site} className="flex items-center justify-between px-4 py-2">
                    <span>{site}</span><span className="font-medium">{ngn(total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Consumables per site</h2></CardHeader>
          <CardContent className="p-0">
            {consBySite.size === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-2">No consumables.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {[...consBySite.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([site, v]) => (
                  <li key={site} className="flex items-center justify-between px-4 py-2">
                    <span>{site} <span className="text-ink-2">· {v.count} item{v.count !== 1 ? "s" : ""}</span></span>
                    <span className="font-medium">{ngn(v.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
