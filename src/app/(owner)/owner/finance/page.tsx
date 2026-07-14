import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { SortableFinanceTable, type FinanceItem } from "@/components/finance/SortableFinanceTable";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const periodKey = (iso: string, gran: "week" | "month"): string => {
  const d = new Date(iso);
  return gran === "month" ? iso.slice(0, 7) : isoWeekKey(d);
};

type Row = { date: string; site_id: string; site: string; amount: number; machine_id?: string; machine?: string; supplier?: string };

export default async function OwnerFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; site?: string; machine?: string; gran?: string }>;
}) {
  const sp = await searchParams;
  const gran: "week" | "month" = sp.gran === "week" ? "week" : "month";
  const today = new Date();
  const defFrom = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const from = sp.from || defFrom;
  const to = sp.to || today.toISOString().slice(0, 10);
  const siteFilter = sp.site || "";
  const machineFilter = sp.machine || "";
  const toEnd = `${to}T23:59:59`;

  const supabase = await createClient();
  const [{ data: sites }, { data: machines }, { data: expRaw }, { data: advRaw }, { data: pmuRaw }, { data: feeRaw }] =
    await Promise.all([
      supabase.from("sites").select("id, name").order("name"),
      supabase.from("machines").select("id, name, site_id").order("name"),
      supabase.from("consumables")
        .select("amount_naira, entry_date, created_at, site_id, category, site:sites(name)")
        .eq("approval_status", "paid"),
      supabase.from("advances")
        .select("amount_naira, paid_at, created_at, site_id, approval_status, site:sites(name), supplier:suppliers(name)")
        .eq("approval_status", "paid"),
      supabase.from("processing_machine_usage")
        .select("line_cost, machine:machines(name, site_id, site:sites(name)), record:processing_records!inner(completed_at, discount_percent)")
        .limit(2000),
      // The processing fee actually deducted from a supplier's batch is the
      // light-bill utility charge (net of discount / any adjustment).
      supabase.from("utility_charges")
        .select("amount, created_at, kind, visit:visits(site_id, site:sites(name), supplier:suppliers(name))")
        .eq("kind", "light_bill"),
    ]);

  const inRange = (iso: string | null) => !!iso && iso.slice(0, 10) >= from && iso <= toEnd;
  const passSite = (sid: string) => !siteFilter || sid === siteFilter;

  // ── Normalise each source to {date, site, amount, machine?} ────────────────
  const expenses: Row[] = (expRaw ?? [])
    .map((e) => ({
      date: (e.entry_date as string) ?? (e.created_at as string),
      site_id: e.site_id as string,
      site: g1<{ name: string }>((e as { site: unknown }).site)?.name ?? "—",
      amount: Number(e.amount_naira),
    }))
    .filter((r) => inRange(r.date) && passSite(r.site_id));

  const advances: Row[] = (advRaw ?? [])
    .map((a) => ({
      date: (a.paid_at as string) ?? (a.created_at as string),
      site_id: a.site_id as string,
      site: g1<{ name: string }>((a as { site: unknown }).site)?.name ?? "—",
      amount: Number(a.amount_naira),
      supplier: g1<{ name: string }>((a as { supplier: unknown }).supplier)?.name ?? "—",
    }))
    .filter((r) => inRange(r.date) && passSite(r.site_id));

  // Processing fees = the light-bill charges actually deducted from suppliers.
  const processing: Row[] = (feeRaw ?? [])
    .map((c) => {
      const v = g1<{ site_id: string; site: unknown; supplier: unknown }>((c as { visit: unknown }).visit);
      return {
        date: c.created_at as string,
        site_id: (v?.site_id as string) ?? "",
        site: g1<{ name: string }>(v?.site)?.name ?? "—",
        amount: Number(c.amount),
        supplier: g1<{ name: string }>(v?.supplier)?.name ?? "—",
      } as Row;
    })
    .filter((r) => inRange(r.date) && passSite(r.site_id));

  // Machine usage (net of discount) — for the machine-utilization view only.
  const machineUsage: Row[] = (pmuRaw ?? [])
    .map((u) => {
      const m = g1<{ name: string; site_id: string; site: unknown }>((u as { machine: unknown }).machine);
      const rec = g1<{ completed_at: string; discount_percent: number }>((u as { record: unknown }).record);
      const netFee = Number(u.line_cost) * (1 - (Number(rec?.discount_percent) || 0) / 100);
      return {
        date: rec?.completed_at ?? "",
        site_id: (m?.site_id as string) ?? "",
        site: g1<{ name: string }>(m?.site)?.name ?? "—",
        amount: netFee,
        machine: m?.name ?? "—",
      } as Row;
    })
    .filter((r) => inRange(r.date) && passSite(r.site_id) && (!machineFilter || r.machine === machineFilter));

  // Itemised rows for the sortable breakdown (by date / site / supplier).
  const items: FinanceItem[] = [
    ...advances.map((r) => ({ type: "Advance" as const, date: r.date, site: r.site, supplier: r.supplier ?? "—", amount: r.amount })),
    ...processing.map((r) => ({ type: "Processing fee" as const, date: r.date, site: r.site, supplier: r.supplier ?? "—", amount: r.amount })),
    ...expenses.map((r) => ({ type: "Consumable" as const, date: r.date, site: r.site, supplier: "—", amount: r.amount })),
  ];

  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.amount, 0);

  // ── Per-period buckets ─────────────────────────────────────────────────────
  const periods = new Map<string, { exp: number; adv: number; proc: number }>();
  const bump = (rows: Row[], key: "exp" | "adv" | "proc") => {
    for (const r of rows) {
      const p = periodKey(r.date, gran);
      const cur = periods.get(p) ?? { exp: 0, adv: 0, proc: 0 };
      cur[key] += r.amount;
      periods.set(p, cur);
    }
  };
  bump(expenses, "exp"); bump(advances, "adv"); bump(processing, "proc");
  const periodRows = Array.from(periods.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // ── Machine utilization (net fee generated per machine) ─────────────────────
  const byMachine = new Map<string, { site: string; total: number; count: number }>();
  for (const r of machineUsage) {
    const cur = byMachine.get(r.machine ?? "—") ?? { site: r.site, total: 0, count: 0 };
    cur.total += r.amount; cur.count += 1;
    byMachine.set(r.machine ?? "—", cur);
  }
  const machineRows = Array.from(byMachine.entries()).sort((a, b) => b[1].total - a[1].total);

  const machineNames = Array.from(new Set((machines ?? []).map((m) => m.name as string)));

  const inputCls = "rounded border px-2 py-1 text-sm";

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Finance breakdown</h1>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium">From<input type="date" name="from" defaultValue={from} className={`mt-1 block ${inputCls}`} /></label>
            <label className="text-xs font-medium">To<input type="date" name="to" defaultValue={to} className={`mt-1 block ${inputCls}`} /></label>
            <label className="text-xs font-medium">Site
              <select name="site" defaultValue={siteFilter} className={`mt-1 block ${inputCls}`}>
                <option value="">All sites</option>
                {(sites ?? []).map((s) => <option key={s.id as string} value={s.id as string}>{s.name as string}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium">Machine
              <select name="machine" defaultValue={machineFilter} className={`mt-1 block ${inputCls}`}>
                <option value="">All machines</option>
                {machineNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium">Breakdown
              <select name="gran" defaultValue={gran} className={`mt-1 block ${inputCls}`}>
                <option value="month">Monthly</option>
                <option value="week">Weekly</option>
              </select>
            </label>
            <button type="submit" className="rounded bg-black px-4 py-1.5 text-sm font-semibold text-white">Apply</button>
          </form>
        </CardContent>
      </Card>

      {/* Totals */}
      <Card>
        <CardContent className="flex flex-wrap gap-6 py-4 text-sm">
          <div><span className="text-zinc-500">Expenses</span><div className="text-lg font-bold">{ngn(sum(expenses))}</div></div>
          <div><span className="text-zinc-500">Advances (paid)</span><div className="text-lg font-bold">{ngn(sum(advances))}</div></div>
          <div><span className="text-zinc-500">Processing fees</span><div className="text-lg font-bold">{ngn(sum(processing))}</div></div>
        </CardContent>
      </Card>

      {/* Itemised — sortable by date / site / supplier */}
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Itemised breakdown</h2></CardHeader>
        <CardContent className="p-0 pb-3">
          <SortableFinanceTable items={items} />
        </CardContent>
      </Card>

      {/* Per-period */}
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">{gran === "month" ? "Monthly" : "Weekly"} breakdown</h2></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-zinc-500">
              <tr><th className="px-4 py-2">Period</th><th className="px-4 py-2 text-right">Expenses</th><th className="px-4 py-2 text-right">Advances</th><th className="px-4 py-2 text-right">Processing</th><th className="px-4 py-2 text-right">Total</th></tr>
            </thead>
            <tbody>
              {periodRows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-3 text-zinc-500">No data in range.</td></tr>
              ) : periodRows.map(([p, v]) => (
                <tr key={p} className="border-b border-line/60">
                  <td className="px-4 py-2 font-medium">{p}</td>
                  <td className="px-4 py-2 text-right">{ngn(v.exp)}</td>
                  <td className="px-4 py-2 text-right">{ngn(v.adv)}</td>
                  <td className="px-4 py-2 text-right">{ngn(v.proc)}</td>
                  <td className="px-4 py-2 text-right font-semibold">{ngn(v.exp + v.adv + v.proc)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </CardContent>
      </Card>

      {/* By machine */}
      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Machine utilization (fee generated)</h2></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-zinc-500">
              <tr><th className="px-4 py-2">Machine</th><th className="px-4 py-2">Site</th><th className="px-4 py-2 text-right">Runs</th><th className="px-4 py-2 text-right">Total fee</th></tr>
            </thead>
            <tbody>
              {machineRows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-3 text-zinc-500">No processing in range.</td></tr>
              ) : machineRows.map(([name, v]) => (
                <tr key={name} className="border-b border-line/60">
                  <td className="px-4 py-2 font-medium">{name}</td>
                  <td className="px-4 py-2 text-zinc-500">{v.site}</td>
                  <td className="px-4 py-2 text-right">{v.count}</td>
                  <td className="px-4 py-2 text-right font-semibold">{ngn(v.total)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </CardContent>
      </Card>
    </main>
  );
}
