import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { setAdvanceApproval } from "@/app/(manager)/manager/advances/actions";
import { reviewExpense } from "@/app/(inventory)/inventory/consumables/actions";
import { approvePricing, rejectPricing } from "@/app/visits/[id]/batch-actions";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default async function OwnerApprovalsPage() {
  const supabase = await createClient();

  const [{ data: movements }, { data: settledLightBills }, { data: advances }, { data: pendingAdvances }] =
    await Promise.all([
      supabase.from("stock_movements").select("weight, direction, material:material_types(name)"),
      supabase.from("batch_settlements").select("light_bill_total"),
      supabase.from("advances").select("amount_naira, approval_status, supplier_id"),
      supabase.from("advances")
        .select("id, purpose, amount_naira, created_at, supplier:suppliers(name, supplier_code)")
        .eq("approval_status", "pending").order("created_at", { ascending: true }),
    ]);

  const { data: pendingExpenses } = await supabase
    .from("consumables")
    .select("id, name, category, amount_naira, entry_date, site:sites(name)")
    .eq("approval_status", "pending")
    .order("entry_date", { ascending: true });

  // Batches the manager has priced, awaiting the owner's approval (#1/#5).
  const { data: pendingPrices } = await supabase
    .from("visits")
    .select("id, created_at, supplier:suppliers(name), declared_material_type:material_types(name), site:sites(name), pricing:pricing(purchase_amount), materials:visit_materials(weight_kg, unit_price, purchase_amount, material:material_types(name))")
    .eq("state", "awaiting_price_approval")
    .order("created_at", { ascending: true });

  // Overview: materials on hand (ledger balance), light bills deducted, advances out.
  const onHand = new Map<string, number>();
  for (const m of movements ?? []) {
    const name = g1<{ name: string }>((m as { material: unknown }).material)?.name ?? "—";
    onHand.set(name, (onHand.get(name) ?? 0) + (m.direction === "in" ? 1 : -1) * Number(m.weight));
  }
  const onHandRows = [...onHand.entries()].filter(([, kg]) => kg > 0.0005).sort((a, b) => a[0].localeCompare(b[0]));
  const lightBillsDeducted = (settledLightBills ?? []).reduce((s, r) => s + Number(r.light_bill_total), 0);
  const advancesOut = (advances ?? []).filter((a) => a.approval_status === "paid").reduce((s, a) => s + Number(a.amount_naira), 0);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Approvals &amp; overview</h1>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Processing fees deducted</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ink">{ngn(lightBillsDeducted)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Advances given out</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ink">{ngn(advancesOut)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Pending approvals</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ore">{(pendingPrices?.length ?? 0) + (pendingAdvances?.length ?? 0) + (pendingExpenses?.length ?? 0)}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Materials at hand</h2></CardHeader>
        <CardContent className="p-0">
          {onHandRows.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No stock on hand.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {onHandRows.map(([name, kg]) => (
                <li key={name} className="flex items-center justify-between px-4 py-2">
                  <span>{name}</span><span className="mono font-medium">{kg.toFixed(3)} kg</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Prices awaiting owner approval (#1/#5) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Prices awaiting approval</h2>
            <Badge variant={pendingPrices?.length ? "yellow" : "default"}>{pendingPrices?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(pendingPrices?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No prices pending approval.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingPrices ?? []).map((v) => {
                const sup = g1<{ name: string }>((v as { supplier: unknown }).supplier);
                const site = g1<{ name: string }>((v as { site: unknown }).site);
                const pr = g1<{ purchase_amount: number }>((v as { pricing: unknown }).pricing);
                const lines = ((v as { materials: unknown }).materials ?? []) as { weight_kg: number; unit_price: number | null; material: unknown }[];
                return (
                  <li key={v.id as string} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/visits/${v.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                        <Stamp>{(v.id as string).slice(0, 8).toUpperCase()}</Stamp>
                        <strong>{sup?.name ?? "—"}</strong>
                        <span className="text-ink-2">· {site?.name ?? "—"} · {formatTimestamp(v.created_at as string)}</span>
                        {pr?.purchase_amount != null && <span className="font-medium">· Total {ngn(Number(pr.purchase_amount))}</span>}
                      </Link>
                      <div className="flex shrink-0 gap-2">
                        <form action={approvePricing}>
                          <input type="hidden" name="visit_id" value={v.id as string} />
                          <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve &amp; finalize</button>
                        </form>
                        <form action={rejectPricing}>
                          <input type="hidden" name="visit_id" value={v.id as string} />
                          <button type="submit" className="rounded border border-line px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-zinc-50">Send back</button>
                        </form>
                      </div>
                    </div>
                    {/* Per-material breakdown: type · kg · unit price */}
                    <ul className="mt-2 space-y-0.5 border-l-2 border-line pl-3 text-xs text-ink-2">
                      {lines.length === 0 ? (
                        <li>No material lines.</li>
                      ) : lines.map((l, i) => {
                        const name = g1<{ name: string }>(l.material)?.name ?? "—";
                        const kg = Number(l.weight_kg ?? 0);
                        return (
                          <li key={i}>
                            <span className="font-medium text-ink">{name}</span>
                            {" · "}{kg.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg
                            {" · "}{l.unit_price != null ? `${ngn(Number(l.unit_price))}/kg` : "unpriced"}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Supplier payments need no separate approval — the owner's price approval
          counts as the payment approval, so an assembled settlement goes straight
          to accounting. */}

      {/* Pending advances */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Advances awaiting approval</h2>
            <Badge variant={pendingAdvances?.length ? "yellow" : "default"}>{pendingAdvances?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(pendingAdvances?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No advances pending.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingAdvances ?? []).map((a) => {
                const sup = g1<{ name: string; supplier_code: string | null }>((a as { supplier: unknown }).supplier);
                return (
                  <li key={a.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <strong>{sup?.name ?? "—"}</strong>
                      {sup?.supplier_code && <Stamp>{sup.supplier_code}</Stamp>}
                      <span className="text-ink-2">{a.purpose as string}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ngn(Number(a.amount_naira))}</span>
                      <form action={setAdvanceApproval}>
                        <input type="hidden" name="advance_id" value={a.id as string} />
                        <input type="hidden" name="decision" value="approved" />
                        <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve</button>
                      </form>
                      <form action={setAdvanceApproval}>
                        <input type="hidden" name="advance_id" value={a.id as string} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button type="submit" className="rounded border px-3 py-1 text-xs">Reject</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pending expenses (consumables) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Expenses awaiting approval</h2>
            <Badge variant={pendingExpenses?.length ? "yellow" : "default"}>{pendingExpenses?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {(pendingExpenses?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No expenses pending.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(pendingExpenses ?? []).map((e) => {
                const site = g1<{ name: string }>((e as { site: unknown }).site);
                return (
                  <li key={e.id as string} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div>
                      <strong>{e.name as string}</strong>
                      <span className="text-ink-2"> · {String(e.category).replace(/_/g, " ")} · {site?.name ?? "—"} · {e.entry_date as string}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.amount_naira != null ? ngn(Number(e.amount_naira)) : "—"}</span>
                      <form action={reviewExpense}>
                        <input type="hidden" name="consumable_id" value={e.id as string} />
                        <input type="hidden" name="decision" value="approved" />
                        <button type="submit" className="rounded bg-approve px-3 py-1 text-xs font-semibold text-white">Approve</button>
                      </form>
                      <form action={reviewExpense}>
                        <input type="hidden" name="consumable_id" value={e.id as string} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button type="submit" className="rounded border px-3 py-1 text-xs">Reject</button>
                      </form>
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
