import Link from "next/link";
import { Boxes, Wallet, ScrollText, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { InventoryTable, type StockRow } from "@/components/dashboard/InventoryTable";
import { ActivityFeed, type ActivityItem } from "@/components/dashboard/ActivityFeed";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { formatNaira, formatWeight, formatTimestamp } from "@/lib/visits/format";
import { STATE_LABELS } from "@/lib/visits/state-machine";
import { approveBulkSale, rejectBulkSale } from "@/app/(inventory)/inventory/bulk-sales/actions";

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}
function defaultTo() {
  return new Date().toISOString().split("T")[0];
}

import { one as g1 } from "@/lib/db/relation";

export default async function OwnerDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const siteFilter  = String(params.site_id ?? "");
  const dateFrom    = String(params.from ?? defaultFrom());
  const dateTo      = String(params.to   ?? defaultTo());
  const dateFromISO = `${dateFrom}T00:00:00`;
  const dateToISO   = `${dateTo}T23:59:59`;

  const supabase = await createClient();

  const [
    { data: sites },
    { data: allVisits },
    { data: pricingRows },
    { data: stockMovements },
    { data: machineUsage },
    { data: consumables },
    { data: pendingBulkSales },
    { data: salePrices },
    { data: recentMovements },
    { data: accountingVisits },
  ] = await Promise.all([
    supabase.from("sites").select("id, name").order("name"),

    (() => {
      let q = supabase
        .from("visits")
        .select("id, state, site_id, created_at")
        .gte("created_at", dateFromISO)
        .lte("created_at", dateToISO);
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    supabase
      .from("pricing")
      .select("agreement_status, visit_id, visit:visits(site_id, created_at)"),

    (() => {
      let q = supabase
        .from("stock_movements")
        .select("site_id, material_type_id, grade, weight, direction, material_type:material_types(name), site:sites(name)");
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    supabase
      .from("processing_machine_usage")
      .select(`
        measurement, line_cost,
        machine:machines(name, charge_basis, site_id),
        processing_record:processing_records(completed_at, visit:visits(site_id))
      `)
      .gte("processing_records.completed_at", dateFromISO)
      .lte("processing_records.completed_at", dateToISO),

    (() => {
      let q = supabase
        .from("consumables")
        .select("name, category, entry_date, comment, site:sites(name), site_id")
        .order("entry_date", { ascending: false })
        .limit(12);
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    supabase
      .from("bulk_sales")
      .select(`
        id, buyer_name, buyer_phone, grade, weight, unit_price, total, sold_at,
        site:sites(name),
        material_type:material_types(name),
        recorded_by_profile:profiles!bulk_sales_recorded_by_fkey(full_name)
      `)
      .eq("approval_status", "pending")
      .order("created_at", { ascending: true }),

    // Approved sale prices → average unit price per material (for stock valuation)
    supabase
      .from("bulk_sales")
      .select("material_type_id, unit_price")
      .eq("approval_status", "approved"),

    // Recent stock activity feed
    (() => {
      let q = supabase
        .from("stock_movements")
        .select(`
          id, weight, grade, direction, reason, created_at, site_id,
          material_type:material_types(name),
          recorded_by_profile:profiles!stock_movements_recorded_by_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .limit(12);
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    (() => {
      let q = supabase
        .from("visits")
        .select(`
          id, state,
          supplier:suppliers(name),
          site:sites(name),
          pricing:pricing(purchase_amount),
          payments:payments(direction, amount),
          processing_records:processing_records(usage:processing_machine_usage(line_cost))
        `)
        .in("state", ["in_accounting", "awaiting_stock_intake"]);
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),
  ]);

  // ── Visit funnel + rejection ──────────────────────────────────────────────
  const stateCounts: Record<string, number> = {};
  for (const v of allVisits ?? []) stateCounts[v.state] = (stateCounts[v.state] ?? 0) + 1;
  const totalVisits = (allVisits ?? []).length;

  let agreedCount = 0, rejectedCount = 0;
  for (const pr of pricingRows ?? []) {
    const visit = g1<{ site_id?: string }>((pr as { visit: unknown }).visit);
    if (siteFilter && visit?.site_id !== siteFilter) continue;
    if (pr.agreement_status === "agreed") agreedCount++;
    else if (pr.agreement_status === "not_agreed") rejectedCount++;
  }
  const totalDecided = agreedCount + rejectedCount;
  const rejectionRate = totalDecided > 0 ? (rejectedCount / totalDecided) * 100 : null;

  // ── Price map: avg approved unit_price per material_type_id ────────────────
  const priceAgg = new Map<string, { sum: number; n: number }>();
  for (const s of salePrices ?? []) {
    const id = s.material_type_id as string;
    const cur = priceAgg.get(id) ?? { sum: 0, n: 0 };
    cur.sum += Number(s.unit_price); cur.n += 1;
    priceAgg.set(id, cur);
  }
  const avgPrice = (materialTypeId: string) => {
    const a = priceAgg.get(materialTypeId);
    return a && a.n > 0 ? a.sum / a.n : 0;
  };

  // ── Stock balance per (site, material, grade) ─────────────────────────────
  const stockMap = new Map<string, { material: string; site: string; grade: string | null; weight: number; materialTypeId: string }>();
  for (const m of stockMovements ?? []) {
    const materialName = g1<{ name: string }>((m as { material_type: unknown }).material_type)?.name ?? "—";
    const siteName = g1<{ name: string }>((m as { site: unknown }).site)?.name ?? "—";
    const key = `${m.site_id}::${m.material_type_id}::${m.grade ?? ""}`;
    const delta = (m.direction === "in" ? 1 : -1) * Number(m.weight);
    const existing = stockMap.get(key);
    if (existing) existing.weight += delta;
    else stockMap.set(key, { material: materialName, site: siteName, grade: m.grade as string | null, weight: delta, materialTypeId: m.material_type_id as string });
  }
  const stockRows: StockRow[] = Array.from(stockMap.values())
    .filter((r) => r.weight > 0)
    .map((r) => ({
      material: r.material,
      site: r.site,
      grade: r.grade,
      weight: r.weight,
      value: r.weight * avgPrice(r.materialTypeId),
    }));
  const totalStockKg = stockRows.reduce((s, r) => s + r.weight, 0);
  const totalStockValue = stockRows.reduce((s, r) => s + r.value, 0);

  // ── Activity feed ─────────────────────────────────────────────────────────
  const activity: ActivityItem[] = (recentMovements ?? []).map((m) => ({
    id: m.id as string,
    actor: g1<{ full_name: string }>((m as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? null,
    item: g1<{ name: string }>((m as { material_type: unknown }).material_type)?.name ?? "—",
    grade: m.grade as string | null,
    weight: Number(m.weight),
    direction: m.direction as "in" | "out",
    reason: m.reason as string,
    at: m.created_at as string,
  }));

  // ── Machine utilization ───────────────────────────────────────────────────
  const machineMap = new Map<string, { name: string; totalMeasurement: number; totalFee: number; charge_basis: string }>();
  for (const u of machineUsage ?? []) {
    const pr = g1<{ visit?: unknown }>((u as { processing_record: unknown }).processing_record);
    if (!pr) continue;
    const visit = g1<{ site_id?: string }>(pr.visit);
    if (siteFilter && visit?.site_id !== siteFilter) continue;
    const machine = g1<{ name?: string; charge_basis?: string }>((u as { machine: unknown }).machine);
    const name = machine?.name ?? "—";
    const existing = machineMap.get(name);
    if (existing) {
      existing.totalMeasurement += Number(u.measurement);
      existing.totalFee += Number(u.line_cost);
    } else {
      machineMap.set(name, { name, totalMeasurement: Number(u.measurement), totalFee: Number(u.line_cost), charge_basis: machine?.charge_basis ?? "" });
    }
  }
  const machineRows = Array.from(machineMap.values()).sort((a, b) => b.totalFee - a.totalFee);

  // ── Outstanding balances (top 5) ──────────────────────────────────────────
  type BalanceRow = { id: string; supplier: string; site: string; processingOwed: number; purchaseOwed: number; processingPaid: number; purchasePaid: number };
  const balanceRows: BalanceRow[] = [];
  for (const v of accountingVisits ?? []) {
    const sup = g1<{ name?: string }>(v.supplier);
    const site = g1<{ name?: string }>(v.site);
    const pr = g1<{ purchase_amount?: number }>(v.pricing);
    const prRecsRaw = (v as { processing_records: unknown }).processing_records;
    const prRecs: unknown[] = Array.isArray(prRecsRaw) ? prRecsRaw : prRecsRaw ? [prRecsRaw] : [];
    const processingOwed = prRecs.reduce((s: number, rec: unknown) => {
      const r = rec as { usage?: { line_cost?: number }[] };
      return s + (r.usage ?? []).reduce((ss: number, u: { line_cost?: number }) => ss + Number(u.line_cost ?? 0), 0);
    }, 0);
    const pmts = (v as { payments: { direction: string; amount: number }[] }).payments ?? [];
    const processingPaid = pmts.filter((p) => p.direction === "processing_fee_in").reduce((s, p) => s + Number(p.amount), 0);
    const purchasePaid = pmts.filter((p) => p.direction === "purchase_amount_out").reduce((s, p) => s + Number(p.amount), 0);
    balanceRows.push({
      id: v.id as string,
      supplier: sup?.name ?? "—",
      site: site?.name ?? "—",
      processingOwed,
      purchaseOwed: Number(pr?.purchase_amount ?? 0),
      processingPaid,
      purchasePaid,
    });
  }
  balanceRows.sort((a, b) => (b.purchaseOwed - b.purchasePaid) - (a.purchaseOwed - a.purchasePaid));

  const sitesTyped = (sites ?? []) as { id: string; name: string }[];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Owner Dashboard</h1>
          <p className="text-sm text-zinc-500">Cross-site overview · {dateFrom} – {dateTo}</p>
        </div>
        <FilterBar
          sites={sitesTyped}
          currentSiteId={siteFilter}
          currentFrom={dateFrom}
          currentTo={dateTo}
        />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total stock" value={formatWeight(totalStockKg)} icon={<Boxes size={18} />} sub={`${stockRows.length} buckets`} />
        <KpiCard label="Est. stock value" value={formatNaira(totalStockValue)} icon={<Wallet size={18} />} sub="from approved sale prices" />
        <KpiCard label="Visits (period)" value={totalVisits} icon={<ScrollText size={18} />} />
        <KpiCard
          label="Rejection rate"
          value={rejectionRate == null ? "—" : `${rejectionRate.toFixed(1)}%`}
          icon={<Percent size={18} />}
          sub={`${rejectedCount}/${totalDecided} decided`}
        />
      </div>

      {/* Inventory table + activity feed */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <InventoryTable rows={stockRows} canCreateVisit={false} />
        </div>
        <ActivityFeed items={activity} />
      </div>

      {/* Visit pipeline + Outstanding balances */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Visit pipeline</h2>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.entries(stateCounts).length === 0 ? (
              <p className="text-sm text-zinc-500">No visits in this period.</p>
            ) : (
              Object.entries(stateCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([state, count]) => (
                  <div key={state} className="flex items-center justify-between text-sm">
                    <Badge variant={stateVariant(state)}>
                      {STATE_LABELS[state as keyof typeof STATE_LABELS] ?? state}
                    </Badge>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Outstanding balances (top 5)</h2>
          </CardHeader>
          <CardContent>
            {balanceRows.length === 0 ? (
              <p className="text-sm text-zinc-500">No outstanding balances.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {balanceRows.slice(0, 5).map((r) => {
                  const purchaseBalance = r.purchaseOwed - r.purchasePaid;
                  const procBalance = r.processingOwed - r.processingPaid;
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-2">
                      <div>
                        <Link href={`/visits/${r.id}`} className="font-medium hover:underline">{r.supplier}</Link>
                        <div className="text-xs text-zinc-500">{r.site}</div>
                      </div>
                      <div className="space-y-0.5 text-right text-xs">
                        {purchaseBalance > 0 && <div className="text-red-600 dark:text-red-400">Owe: {formatNaira(purchaseBalance)}</div>}
                        {procBalance > 0 && <div className="text-blue-600 dark:text-blue-400">Fee due: {formatNaira(procBalance)}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Machine utilization + Consumables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Machine utilization (period)</h2>
          </CardHeader>
          <CardContent>
            {machineRows.length === 0 ? (
              <p className="text-sm text-zinc-500">No processing data in this period.</p>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                    <th className="py-1 text-left">Machine</th>
                    <th className="py-1 text-right">Processed</th>
                    <th className="py-1 text-right">Fee generated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                  {machineRows.map((r) => (
                    <tr key={r.name}>
                      <td className="py-1">{r.name}</td>
                      <td className="py-1 text-right text-zinc-500">{r.totalMeasurement.toFixed(2)} {r.charge_basis}</td>
                      <td className="py-1 text-right font-medium">{formatNaira(r.totalFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold">Recent consumables</h2>
          </CardHeader>
          <CardContent>
            {(consumables?.length ?? 0) === 0 ? (
              <p className="text-sm text-zinc-500">No consumables logged.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {(consumables ?? []).map((c, i) => {
                  const site = g1<{ name?: string }>(c.site);
                  const category = String(c.category ?? "").replace(/_/g, " ");
                  return (
                    <li key={`${c.site_id}-${c.name}-${i}`} className="flex items-center justify-between py-2">
                      <div>
                        <div className="font-medium">{c.name as string}</div>
                        <div className="text-xs capitalize text-zinc-500">
                          {category} · {site?.name ?? "—"}
                        </div>
                      </div>
                      <div className="text-xs text-zinc-500">{c.entry_date as string}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending bulk sales */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold">Pending bulk sales ({pendingBulkSales?.length ?? 0})</h2>
        </CardHeader>
        <CardContent>
          {!pendingBulkSales || pendingBulkSales.length === 0 ? (
            <p className="text-sm text-zinc-500">No pending bulk sales.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {pendingBulkSales.map((s) => {
                const mat = g1<{ name?: string }>(s.material_type);
                const site = g1<{ name?: string }>(s.site);
                const recName = g1<{ full_name?: string }>((s as { recorded_by_profile: unknown }).recorded_by_profile)?.full_name ?? "—";
                return (
                  <li key={s.id as string} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <div className="font-medium">
                          {s.buyer_name as string}
                          {s.buyer_phone ? <span className="font-normal text-zinc-500"> · {s.buyer_phone as string}</span> : null}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {site?.name ?? "—"} · {mat?.name ?? "—"}
                          {s.grade ? ` · ${s.grade}` : ""} · {formatWeight(Number(s.weight))} ×{" "}
                          {formatNaira(Number(s.unit_price))} = <strong>{formatNaira(Number(s.total))}</strong>
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-400">by {recName} · {formatTimestamp(s.sold_at as string)}</div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <form action={approveBulkSale}>
                          <input type="hidden" name="id" value={s.id as string} />
                          <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">Approve</button>
                        </form>
                        <form action={rejectBulkSale} className="flex gap-1">
                          <input type="hidden" name="id" value={s.id as string} />
                          <input type="text" name="rejection_note" placeholder="Reason" className="w-24 rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800" />
                          <button type="submit" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700">Reject</button>
                        </form>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
