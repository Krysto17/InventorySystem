import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, stateVariant } from "@/components/ui/badge";
import { formatNaira, formatWeight, formatTimestamp } from "@/lib/visits/format";
import { STATE_LABELS } from "@/lib/visits/state-machine";
import { approveBulkSale, rejectBulkSale } from "@/app/(inventory)/inventory/bulk-sales/actions";

// ─── Filter helpers ──────────────────────────────────────────────────────────

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function defaultTo() {
  return new Date().toISOString().split("T")[0];
}

// ─── Page ────────────────────────────────────────────────────────────────────

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

  // ── Parallel data fetch ──────────────────────────────────────────────────
  const [
    { data: sites },
    { data: allVisits },
    { data: pricingRows },
    { data: payments },
    { data: stockMovements },
    { data: machineUsage },
    { data: consumables },
    { data: awaitingExit },
    { data: pendingBulkSales },
  ] = await Promise.all([
    supabase.from("sites").select("id, name").order("name"),

    // Visits for funnel + rejection (created in period, optionally filtered by site)
    (() => {
      let q = supabase
        .from("visits")
        .select("id, state, site_id, created_at")
        .gte("created_at", dateFromISO)
        .lte("created_at", dateToISO);
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    // Pricing rows for rejection rate
    (() => {
      let q = supabase
        .from("pricing")
        .select("agreement_status, visit_id, visit:visits(site_id, created_at)");
      if (siteFilter) q = q.eq("visits.site_id", siteFilter as never);
      return q;
    })(),

    // Payments in period
    (() => {
      let q = supabase
        .from("payments")
        .select("direction, amount, paid_at, visit:visits(site_id)")
        .gte("paid_at", dateFromISO)
        .lte("paid_at", dateToISO);
      return q;
    })(),

    // Stock movements (all time — running ledger, not period-filtered)
    (() => {
      let q = supabase
        .from("stock_movements")
        .select("site_id, material_type_id, grade, weight, direction, material_type:material_types(name), site:sites(name)");
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    // Machine utilization in period
    (() => {
      return supabase
        .from("processing_machine_usage")
        .select(`
          measurement, line_cost,
          machine:machines(name, charge_basis, site_id),
          processing_record:processing_records(completed_at, visit:visits(site_id))
        `)
        .gte("processing_records.completed_at", dateFromISO)
        .lte("processing_records.completed_at", dateToISO);
    })(),

    // Consumables (live on_hand, filtered by site)
    (() => {
      let q = supabase
        .from("consumables")
        .select("name, on_hand, unit, site:sites(name), site_id")
        .order("name");
      if (siteFilter) q = q.eq("site_id", siteFilter);
      return q;
    })(),

    // Awaiting gate exit (cross-site — no site filter, owner sees all)
    supabase
      .from("visits")
      .select(`id, created_at, vehicle_plate,
               site:sites(name),
               supplier:suppliers(name),
               declared_material_type:material_types(name)`)
      .eq("state", "awaiting_gate_exit")
      .order("created_at", { ascending: true }),

    // Pending bulk sales (cross-site)
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
  ]);

  // ── Outstanding balances (visits in accounting/intake states) ────────────
  const { data: accountingVisits } = await (() => {
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
  })();

  // ── Aggregate: visit funnel (counts per state) ───────────────────────────
  const stateCounts: Record<string, number> = {};
  for (const v of allVisits ?? []) {
    stateCounts[v.state] = (stateCounts[v.state] ?? 0) + 1;
  }
  const totalVisits = (allVisits ?? []).length;

  // ── Aggregate: cash flow per direction ───────────────────────────────────
  let totalIn = 0, totalOut = 0;
  for (const p of payments ?? []) {
    const v = p.visit as unknown as { site_id?: string } | { site_id?: string }[] | null;
    const visitSiteId = Array.isArray(v) ? v[0]?.site_id : (v as { site_id?: string } | null)?.site_id;
    if (siteFilter && visitSiteId !== siteFilter) continue;
    if (p.direction === "processing_fee_in") totalIn += Number(p.amount);
    else totalOut += Number(p.amount);
  }

  // ── Aggregate: rejection rate ─────────────────────────────────────────────
  let agreedCount = 0, rejectedCount = 0;
  for (const pr of pricingRows ?? []) {
    const v = (pr as { visit: unknown }).visit;
    const visitSiteId = (Array.isArray(v) ? v[0] : v) as { site_id?: string; created_at?: string } | null;
    if (siteFilter && visitSiteId?.site_id !== siteFilter) continue;
    if (pr.agreement_status === "agreed") agreedCount++;
    else if (pr.agreement_status === "not_agreed") rejectedCount++;
  }
  const totalDecided = agreedCount + rejectedCount;
  const rejectionRate = totalDecided > 0 ? ((rejectedCount / totalDecided) * 100).toFixed(1) : "—";

  // ── Aggregate: stock balance per (site, material, grade) ─────────────────
  type StockKey = string;
  const stockMap = new Map<StockKey, { material_name: string; site_name: string; grade: string | null; balance: number }>();
  for (const m of stockMovements ?? []) {
    const mt = (m as { material_type: unknown }).material_type;
    const site = (m as { site: unknown }).site;
    const materialName = (Array.isArray(mt) ? mt[0]?.name : (mt as { name?: string } | null)?.name) ?? "—";
    const siteName = (Array.isArray(site) ? site[0]?.name : (site as { name?: string } | null)?.name) ?? "—";
    const key: StockKey = `${m.site_id}::${m.material_type_id}::${m.grade ?? ""}`;
    const delta = (m.direction === "in" ? 1 : -1) * Number(m.weight);
    const existing = stockMap.get(key);
    if (existing) { existing.balance += delta; }
    else stockMap.set(key, { material_name: materialName, site_name: siteName, grade: m.grade as string | null, balance: delta });
  }
  const stockRows = Array.from(stockMap.values()).filter((r) => r.balance > 0);
  const totalStockKg = stockRows.reduce((s, r) => s + r.balance, 0);

  // ── Aggregate: machine utilization ───────────────────────────────────────
  type MachineKey = string;
  const machineMap = new Map<MachineKey, { name: string; totalMeasurement: number; totalFee: number; count: number; charge_basis: string }>();
  for (const u of machineUsage ?? []) {
    const prRaw = (u as { processing_record: unknown }).processing_record;
    const pr = Array.isArray(prRaw) ? prRaw[0] : prRaw as { visit?: unknown; completed_at?: string } | null;
    if (!pr) continue;
    const visitRaw = pr.visit;
    const visit = (Array.isArray(visitRaw) ? visitRaw[0] : visitRaw) as { site_id?: string } | null;
    if (siteFilter && visit?.site_id !== siteFilter) continue;
    const mRaw = (u as { machine: unknown }).machine;
    const machine = (Array.isArray(mRaw) ? mRaw[0] : mRaw) as { name?: string; charge_basis?: string } | null;
    const name = machine?.name ?? "—";
    const existing = machineMap.get(name);
    if (existing) {
      existing.totalMeasurement += Number(u.measurement);
      existing.totalFee += Number(u.line_cost);
      existing.count++;
    } else {
      machineMap.set(name, { name, totalMeasurement: Number(u.measurement), totalFee: Number(u.line_cost), count: 1, charge_basis: machine?.charge_basis ?? "" });
    }
  }
  const machineRows = Array.from(machineMap.values()).sort((a, b) => b.totalFee - a.totalFee);

  // ── Aggregate: outstanding balances (top 5) ───────────────────────────────
  type BalanceRow = { id: string; supplier: string; site: string; processingOwed: number; purchaseOwed: number; processingPaid: number; purchasePaid: number; state: string };
  const balanceRows: BalanceRow[] = [];
  for (const v of accountingVisits ?? []) {
    const sup = (Array.isArray(v.supplier) ? v.supplier[0] : v.supplier) as { name?: string } | null;
    const site = (Array.isArray(v.site) ? v.site[0] : v.site) as { name?: string } | null;
    const pr = (Array.isArray(v.pricing) ? v.pricing[0] : v.pricing) as { purchase_amount?: number } | null;
    const prRecsRaw = (v as { processing_records: unknown }).processing_records;
    const prRecs: unknown[] = Array.isArray(prRecsRaw) ? prRecsRaw : prRecsRaw ? [prRecsRaw] : [];
    const processingOwed = prRecs.reduce((s: number, rec: unknown) => {
      const r = rec as { usage?: { line_cost?: number }[] };
      return s + (r.usage ?? []).reduce((ss: number, u: { line_cost?: number }) => ss + Number(u.line_cost ?? 0), 0);
    }, 0);
    const payments = (v as { payments: { direction: string; amount: number }[] }).payments ?? [];
    const processingPaid = payments.filter((p) => p.direction === "processing_fee_in").reduce((s, p) => s + Number(p.amount), 0);
    const purchasePaid = payments.filter((p) => p.direction === "purchase_amount_out").reduce((s, p) => s + Number(p.amount), 0);
    balanceRows.push({
      id: v.id as string,
      supplier: sup?.name ?? "—",
      site: site?.name ?? "—",
      processingOwed,
      purchaseOwed: Number(pr?.purchase_amount ?? 0),
      processingPaid,
      purchasePaid,
      state: v.state as string,
    });
  }
  balanceRows.sort((a, b) => (b.purchaseOwed - b.purchasePaid) - (a.purchaseOwed - a.purchasePaid));

  const sitesTyped = (sites ?? []) as { id: string; name: string }[];

  return (
    <main className="p-6 max-w-7xl mx-auto space-y-8">

      {/* Header + nav */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Owner Dashboard</h1>
          <p className="text-sm text-gray-500">Cross-site overview · {dateFrom} – {dateTo}</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link href="/owner/employees"     className="px-3 py-1.5 border rounded hover:bg-gray-100">Employees</Link>
          <Link href="/owner/material-types" className="px-3 py-1.5 border rounded hover:bg-gray-100">Material types</Link>
          <Link href="/owner/machines"       className="px-3 py-1.5 border rounded hover:bg-gray-100">Machines</Link>
          <Link href="/owner/visits"         className="px-3 py-1.5 border rounded hover:bg-gray-100">All visits</Link>
          <Link href="/owner/search"         className="px-3 py-1.5 border rounded hover:bg-gray-100">Search</Link>
        </nav>
      </div>

      {/* Filters */}
      <FilterBar
        sites={sitesTyped}
        currentSiteId={siteFilter}
        currentFrom={dateFrom}
        currentTo={dateTo}
      />

      {/* ── Row 1: Key metrics ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Visits (period)" value={totalVisits} />
        <StatCard label="Processing fees collected" value={formatNaira(totalIn)} accent="green" />
        <StatCard label="Purchase amount paid out" value={formatNaira(totalOut)} accent="red" />
        <StatCard
          label="Rejection rate"
          value={rejectionRate === "—" ? "—" : `${rejectionRate}%`}
          sub={`${rejectedCount} / ${totalDecided} decided`}
          accent={Number(rejectionRate) > 20 ? "red" : "green"}
        />
      </div>

      {/* ── Row 2: Visit funnel + Outstanding balances ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Visit funnel */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-sm">Visit pipeline</h2>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.entries(stateCounts).length === 0 ? (
              <p className="text-sm text-gray-500">No visits in this period.</p>
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

        {/* Outstanding balances */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Outstanding balances (top 5)</h2>
            </div>
          </CardHeader>
          <CardContent>
            {balanceRows.length === 0 ? (
              <p className="text-sm text-gray-500">No outstanding balances.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {balanceRows.slice(0, 5).map((r) => {
                  const purchaseBalance = r.purchaseOwed - r.purchasePaid;
                  const procBalance = r.processingOwed - r.processingPaid;
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-2">
                      <div>
                        <Link href={`/visits/${r.id}`} className="font-medium hover:underline">
                          {r.supplier}
                        </Link>
                        <div className="text-xs text-gray-500">{r.site}</div>
                      </div>
                      <div className="text-right text-xs space-y-0.5">
                        {purchaseBalance > 0 && (
                          <div className="text-red-700">Owe: {formatNaira(purchaseBalance)}</div>
                        )}
                        {procBalance > 0 && (
                          <div className="text-blue-700">Fee due: {formatNaira(procBalance)}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Stock + Machine utilization ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Live stock */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-sm">Live stock</h2>
              <span className="text-xs text-gray-500">Total: {formatWeight(totalStockKg)}</span>
            </div>
          </CardHeader>
          <CardContent>
            {stockRows.length === 0 ? (
              <p className="text-sm text-gray-500">No stock on hand.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-1">Site</th>
                    <th className="text-left py-1">Material</th>
                    <th className="text-left py-1">Grade</th>
                    <th className="text-right py-1">On hand</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stockRows.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1 text-xs text-gray-500">{r.site_name}</td>
                      <td className="py-1">{r.material_name}</td>
                      <td className="py-1 text-gray-600">{r.grade ?? "—"}</td>
                      <td className="py-1 text-right font-medium">{formatWeight(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Machine utilization */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-sm">Machine utilization (period)</h2>
          </CardHeader>
          <CardContent>
            {machineRows.length === 0 ? (
              <p className="text-sm text-gray-500">No processing data in this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left py-1">Machine</th>
                    <th className="text-right py-1">Processed</th>
                    <th className="text-right py-1">Fee generated</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {machineRows.map((r) => (
                    <tr key={r.name}>
                      <td className="py-1">{r.name}</td>
                      <td className="py-1 text-right text-gray-600">
                        {r.totalMeasurement.toFixed(2)} {r.charge_basis}
                      </td>
                      <td className="py-1 text-right font-medium">{formatNaira(r.totalFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Consumables ─────────────────────────────────────────── */}
      {(consumables?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-sm">Consumables on hand</h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(consumables ?? []).map((c) => {
                const site = (Array.isArray(c.site) ? c.site[0] : c.site) as { name?: string } | null;
                return (
                  <div key={`${c.site_id}-${c.name}`} className="text-sm border rounded p-2">
                    <div className="font-medium">{c.name as string}</div>
                    <div className="text-xs text-gray-500">{site?.name ?? "—"}</div>
                    <div className="text-lg font-bold mt-1">
                      {Number(c.on_hand).toFixed(2)}{" "}
                      <span className="text-xs font-normal text-gray-500">
                        {(c.unit as string | null) ?? "units"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Awaiting-owner queue: gate exits ──────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-sm">
            Awaiting gate sign-off ({awaitingExit?.length ?? 0})
          </h2>
        </CardHeader>
        <CardContent>
          {!awaitingExit || awaitingExit.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing awaiting authorization.</p>
          ) : (
            <ul className="divide-y">
              {awaitingExit.map((v) => {
                const sup  = (Array.isArray(v.supplier)  ? v.supplier[0]  : v.supplier)  as { name?: string } | null;
                const mat  = (Array.isArray(v.declared_material_type) ? v.declared_material_type[0] : v.declared_material_type) as { name?: string } | null;
                const site = (Array.isArray(v.site) ? v.site[0] : v.site) as { name?: string } | null;
                return (
                  <li key={v.id}>
                    <Link href={`/visits/${v.id}`} className="flex justify-between py-2 hover:bg-gray-50 px-1 rounded text-sm">
                      <div>
                        <div className="font-medium">{sup?.name ?? "—"}</div>
                        <div className="text-xs text-gray-500">
                          {site?.name ?? "—"} · {mat?.name ?? "—"} · {v.vehicle_plate ?? "no plate"}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">{formatTimestamp(v.created_at)}</div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Awaiting-owner queue: bulk sales ──────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-sm">
            Pending bulk sales ({pendingBulkSales?.length ?? 0})
          </h2>
        </CardHeader>
        <CardContent>
          {!pendingBulkSales || pendingBulkSales.length === 0 ? (
            <p className="text-sm text-gray-500">No pending bulk sales.</p>
          ) : (
            <ul className="divide-y">
              {pendingBulkSales.map((s) => {
                const mat  = (Array.isArray(s.material_type) ? s.material_type[0] : s.material_type) as { name?: string } | null;
                const site = (Array.isArray(s.site) ? s.site[0] : s.site) as { name?: string } | null;
                const rec  = (s as { recorded_by_profile: unknown }).recorded_by_profile;
                const recName = (Array.isArray(rec) ? (rec[0] as { full_name?: string })?.full_name : (rec as { full_name?: string } | null)?.full_name) ?? "—";
                return (
                  <li key={s.id as string} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <div className="font-medium">
                          {s.buyer_name as string}
                          {s.buyer_phone ? <span className="text-gray-500 font-normal"> · {s.buyer_phone as string}</span> : null}
                        </div>
                        <div className="text-xs text-gray-500">
                          {site?.name ?? "—"} · {mat?.name ?? "—"}
                          {s.grade ? ` · ${s.grade}` : ""} · {formatWeight(Number(s.weight))} ×{" "}
                          {formatNaira(Number(s.unit_price))} = <strong>{formatNaira(Number(s.total))}</strong>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          by {recName} · {formatTimestamp(s.sold_at as string)}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <form action={approveBulkSale}>
                          <input type="hidden" name="id" value={s.id as string} />
                          <button type="submit" className="px-3 py-1 bg-green-700 text-white text-xs rounded">Approve</button>
                        </form>
                        <form action={rejectBulkSale} className="flex gap-1">
                          <input type="hidden" name="id" value={s.id as string} />
                          <input type="text" name="rejection_note" placeholder="Reason" className="border rounded px-2 py-1 text-xs w-24" />
                          <button type="submit" className="px-3 py-1 bg-red-700 text-white text-xs rounded">Reject</button>
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

    </main>
  );
}
