import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

// Phase 10 (C): combined + per-site reporting for manager / accountant / owner.
// Read-only — cross-site visibility is granted by RLS (has_cross_site_read).


const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export async function CrossSiteReports() {
  const supabase = await createClient();

  // Both reads are aggregates: one row per site, one per stock bucket. Adding
  // these up in the page meant pulling every lot, advance and payment row.
  const [{ data: rollups }, { data: balances }] = await Promise.all([
    supabase.from("site_rollups").select("*").order("site_name"),
    supabase.from("stock_balances").select("site_id, material_name, weight_kg"),
  ]);
  const sites = (rollups ?? []).map((r) => ({ id: r.site_id as string, name: r.site_name as string }));

  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));

  // Stock at hand by site × material, aggregated in the database (0121).
  const stockKey = (siteId: string, mat: string) => `${siteId}|${mat}`;
  const stock = new Map<string, number>();
  for (const b of balances ?? []) {
    const key = stockKey(b.site_id as string, (b.material_name as string) ?? "—");
    stock.set(key, (stock.get(key) ?? 0) + Number(b.weight_kg));
  }

  // Per-site rollups, already totalled by the database.
  type SiteAgg = { availableLotKg: number; lotValue: number; pendingAdvances: number; paidOut: number; feeIn: number };
  const bySite = new Map<string, SiteAgg>(
    (rollups ?? []).map((r) => [r.site_id as string, {
      availableLotKg: Number(r.available_lot_kg ?? 0),
      lotValue: Number(r.lot_value ?? 0),
      pendingAdvances: Number(r.pending_advances ?? 0),
      feeIn: Number(r.fee_in ?? 0),
      paidOut: Number(r.paid_out ?? 0),
    }]),
  );

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
