import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

// Phase 10 (C): combined + per-site reporting for manager / accountant / owner.
// Read-only — cross-site visibility is granted by RLS (has_cross_site_read).

const g1 = <T,>(v: unknown): T | null =>
  (Array.isArray(v) ? ((v[0] ?? null) as T | null) : ((v ?? null) as T | null));

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export async function CrossSiteReports() {
  const supabase = await createClient();

  const [{ data: sites }, { data: movements }, { data: lots }, { data: advances }, { data: payments }] =
    await Promise.all([
      supabase.from("sites").select("id, name").order("name"),
      supabase.from("stock_movements").select("site_id, material_type_id, weight, direction, material:material_types(name)"),
      supabase.from("stock_lots").select("site_id, weight_kg, cost_price_per_kg, status"),
      supabase.from("advances").select("site_id, amount_naira, approval_status"),
      supabase.from("payments").select("direction, amount, visit:visits!inner(site_id)"),
    ]);

  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));

  // Stock balance by site × material from the movements ledger.
  const stockKey = (siteId: string, mat: string) => `${siteId}|${mat}`;
  const stock = new Map<string, number>();
  for (const m of movements ?? []) {
    const mat = g1<{ name: string }>((m as { material: unknown }).material)?.name ?? "—";
    const key = stockKey(m.site_id as string, mat);
    const delta = (m.direction === "in" ? 1 : -1) * Number(m.weight);
    stock.set(key, (stock.get(key) ?? 0) + delta);
  }

  // Per-site rollups.
  type SiteAgg = { availableLotKg: number; lotValue: number; pendingAdvances: number; paidOut: number; feeIn: number };
  const bySite = new Map<string, SiteAgg>();
  const agg = (siteId: string): SiteAgg => {
    if (!bySite.has(siteId)) {
      bySite.set(siteId, { availableLotKg: 0, lotValue: 0, pendingAdvances: 0, paidOut: 0, feeIn: 0 });
    }
    return bySite.get(siteId)!;
  };
  for (const l of lots ?? []) {
    if (l.status === "available") {
      const a = agg(l.site_id as string);
      a.availableLotKg += Number(l.weight_kg);
      a.lotValue += Number(l.weight_kg) * Number(l.cost_price_per_kg ?? 0);
    }
  }
  for (const a of advances ?? []) {
    if (a.approval_status === "pending") agg(a.site_id as string).pendingAdvances += Number(a.amount_naira);
  }
  for (const p of payments ?? []) {
    const siteId = g1<{ site_id: string }>((p as { visit: unknown }).visit)?.site_id;
    if (!siteId) continue;
    if (p.direction === "purchase_amount_out") agg(siteId).paidOut += Number(p.amount);
    else agg(siteId).feeIn += Number(p.amount);
  }

  const stockRows = [...stock.entries()]
    .map(([key, kg]) => {
      const [siteId, mat] = key.split("|");
      return { site: siteName.get(siteId) ?? "—", mat, kg };
    })
    .filter((r) => r.kg > 0)
    .sort((a, b) => a.site.localeCompare(b.site) || a.mat.localeCompare(b.mat));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Per-site summary (all sites)</h2></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50">
              <tr>
                <th className="px-4 py-2">Site</th>
                <th className="px-4 py-2 text-right">Available lots (kg)</th>
                <th className="px-4 py-2 text-right">Lot value</th>
                <th className="px-4 py-2 text-right">Pending advances</th>
                <th className="px-4 py-2 text-right">Fees in</th>
                <th className="px-4 py-2 text-right">Paid out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {(sites ?? []).map((s) => {
                const a = bySite.get(s.id as string) ?? {
                  availableLotKg: 0, lotValue: 0, pendingAdvances: 0, paidOut: 0, feeIn: 0,
                };
                return (
                  <tr key={s.id as string}>
                    <td className="px-4 py-2 font-medium">{s.name as string}</td>
                    <td className="px-4 py-2 text-right">{a.availableLotKg.toFixed(3)}</td>
                    <td className="px-4 py-2 text-right">{ngn(a.lotValue)}</td>
                    <td className="px-4 py-2 text-right">{ngn(a.pendingAdvances)}</td>
                    <td className="px-4 py-2 text-right">{ngn(a.feeIn)}</td>
                    <td className="px-4 py-2 text-right">{ngn(a.paidOut)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Stock by site × material (ledger balance)</h2></CardHeader>
        <CardContent className="p-0">
          {stockRows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-500">No stock on the ledger.</p>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50">
                <tr>
                  <th className="px-4 py-2">Site</th>
                  <th className="px-4 py-2">Material</th>
                  <th className="px-4 py-2 text-right">Balance (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {stockRows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">{r.site}</td>
                    <td className="px-4 py-2">{r.mat}</td>
                    <td className="px-4 py-2 text-right">{r.kg.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
