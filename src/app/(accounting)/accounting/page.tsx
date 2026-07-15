import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatTimestamp, formatNaira } from "@/lib/visits/format";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveWorkflow } from "@/components/visits/LiveWorkflow";

export default async function AccountingHomePage() {
  const supabase = await createClient();

  const [{ data: visits }, { data: supplies }, { data: advances }, { data: expenses }, { data: corrections }] = await Promise.all([
    supabase
      .from("visits")
      .select(`
        id, created_at, state, processing_deducted,
        supplier:suppliers(name, phone),
        declared_material_type:material_types(name),
        pricing:pricing(payment_terms),
        settlement:batch_settlements(net_balance, status)
      `)
      .eq("state", "in_accounting")
      .order("created_at", { ascending: true }),
    supabase.from("batch_settlements").select("id, net_balance").in("status", ["approved", "partially_paid"]),
    supabase.from("advances").select("amount_naira").eq("approval_status", "approved"),
    supabase.from("consumables").select("amount_naira").eq("approval_status", "approved"),
    supabase.from("price_corrections").select("amount").eq("direction", "underpaid").is("paid_at", null),
  ]);

  // Supplier payouts show what's LEFT to pay (net − payments already recorded).
  const supIds = (supplies ?? []).map((s) => s.id as string);
  const { data: paidRows } = supIds.length
    ? await supabase.from("settlement_payments").select("settlement_id, amount").in("settlement_id", supIds)
    : { data: [] as { settlement_id: string; amount: number }[] };
  const paidBy = new Map<string, number>();
  for (const p of paidRows ?? []) paidBy.set(p.settlement_id as string, (paidBy.get(p.settlement_id as string) ?? 0) + Number(p.amount));
  const suppliesRemaining = (supplies ?? []).reduce((s, r) => s + Math.max(Number(r.net_balance) - (paidBy.get(r.id as string) ?? 0), 0), 0);

  const sum = (rows: Array<Record<string, unknown>> | null, key: "amount_naira" | "amount") =>
    (rows ?? []).reduce((s, r) => s + Number(r[key] ?? 0), 0);
  const payoutCount = (supplies?.length ?? 0) + (advances?.length ?? 0) + (expenses?.length ?? 0) + (corrections?.length ?? 0);
  const payoutTotal = suppliesRemaining + sum(advances, "amount_naira") + sum(expenses, "amount_naira") + sum(corrections, "amount");

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Accounting</h1>
        <p className="text-sm text-gray-500">{visits?.length ?? 0} visit{(visits?.length ?? 0) !== 1 ? "s" : ""} pending settlement</p>
      </header>

      {/* To pay — approved items awaiting payment, above the supply pipeline. */}
      <Link href="/accounting/payouts" className="block">
        <Card className="border-ore/40 transition-colors hover:border-ore">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Approved — to pay</h2>
              <Badge variant={payoutCount ? "yellow" : "default"}>{payoutCount}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {payoutCount === 0 ? (
              <p className="text-sm text-gray-500">Nothing approved to pay right now.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <div><span className="text-gray-500">Supplier payouts</span> <span className="font-semibold">{supplies?.length ?? 0}</span> · {formatNaira(suppliesRemaining)}</div>
                <div><span className="text-gray-500">Advances</span> <span className="font-semibold">{advances?.length ?? 0}</span> · {formatNaira(sum(advances, "amount_naira"))}</div>
                <div><span className="text-gray-500">Expenses</span> <span className="font-semibold">{expenses?.length ?? 0}</span> · {formatNaira(sum(expenses, "amount_naira"))}</div>
                <div className="ml-auto font-semibold">Total: {formatNaira(payoutTotal)}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </Link>

      <LiveWorkflow />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Queue</h2>
            <Badge variant="blue">{visits?.length ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!visits || visits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">Queue is empty.</p>
          ) : (
            <ul className="divide-y">
              {visits.map((v) => {
                const sup = v.supplier as unknown as { name?: string } | null;
                const mat = v.declared_material_type as unknown as { name?: string } | null;
                const pr = v.pricing as unknown as
                  | { payment_terms?: string } | { payment_terms?: string }[] | null;
                const pricing = Array.isArray(pr) ? pr[0] : pr;
                const st = v.settlement as unknown as
                  | { net_balance?: number } | { net_balance?: number }[] | null;
                const settlement = Array.isArray(st) ? st[0] : st;
                // Show only the NET pay (after processing fee + deductions + advances)
                // so the accountant sees exactly what to disburse. Before the manager
                // assembles the settlement there is no net yet.
                const net = settlement?.net_balance;
                return (
                  <li key={v.id}>
                    <Link href={`/visits/${v.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{sup?.name ?? "—"}</div>
                        <div className="text-xs text-gray-500">
                          {mat?.name ?? "—"} · {formatTimestamp(v.created_at)}
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        {net != null ? (
                          <>
                            <div className="font-medium">{formatNaira(Number(net))}</div>
                            <div className="text-xs text-gray-500">net to pay{pricing?.payment_terms ? ` · ${pricing.payment_terms}` : ""}</div>
                          </>
                        ) : (
                          <div className="text-xs text-gray-500">Awaiting settlement</div>
                        )}
                      </div>
                    </Link>
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
