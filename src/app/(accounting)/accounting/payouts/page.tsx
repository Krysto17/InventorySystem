import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stamp } from "@/components/ui/stamp";
import { formatTimestamp } from "@/lib/visits/format";
import { markAdvancePaid, markConsumablePaid, markSettlementPaid } from "./actions";

import { one as g1 } from "@/lib/db/relation";
const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Accountant's queue of owner-approved items awaiting payment. Only the
// accountant marks them paid.
export default async function AccountingPayoutsPage() {
  const supabase = await createClient();

  const [{ data: supplies }, { data: advances }, { data: expenses }] = await Promise.all([
    supabase.from("batch_settlements")
      .select("id, visit_id, net_balance, created_at, visit:visits(supplier:suppliers(name, account_name, account_number, bank_name))")
      .eq("status", "approved").order("created_at", { ascending: true }),
    supabase.from("advances")
      .select("id, purpose, amount_naira, created_at, comment, account_name, account_number, bank_name, supplier:suppliers(name, supplier_code, account_name, account_number, bank_name)")
      .eq("approval_status", "approved").order("created_at", { ascending: true }),
    supabase.from("consumables")
      .select("id, name, category, amount_naira, entry_date, comment, created_at, account_name, account_number, bank_name")
      .eq("approval_status", "approved").order("entry_date", { ascending: true }),
  ]);

  const count = (supplies?.length ?? 0) + (advances?.length ?? 0) + (expenses?.length ?? 0);

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Settlements</Link>
        <h1 className="text-2xl font-bold">Approved — to pay</h1>
        <Badge variant={count ? "yellow" : "default"}>{count}</Badge>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Supplier payouts (batch settlements)</h2></CardHeader>
        <CardContent className="p-0">
          {(supplies?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing approved to pay.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(supplies ?? []).map((s) => {
                const sup = g1<{ name: string; account_name: string | null; account_number: string | null; bank_name: string | null }>(
                  g1<{ supplier: unknown }>((s as { visit: unknown }).visit)?.supplier,
                );
                const hasAcct = sup?.account_name || sup?.account_number || sup?.bank_name;
                return (
                  <li key={s.id as string} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>
                      <Link href={`/visits/${s.visit_id}`} className="font-medium underline">{sup?.name ?? "—"}</Link>
                      <span className="text-ink-2"> · {ngn(Number(s.net_balance))} · {formatTimestamp(s.created_at as string)}</span>
                      <span className="block text-xs text-ink-2">
                        {hasAcct
                          ? <>{sup?.account_name ?? "—"} · <span className="mono">{sup?.account_number ?? "—"}</span> · {sup?.bank_name ?? "—"}</>
                          : "No account details on file"}
                      </span>
                    </span>
                    <form action={markSettlementPaid}>
                      <input type="hidden" name="settlement_id" value={s.id as string} />
                      <button type="submit" className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white">Mark paid</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Supplier advances</h2></CardHeader>
        <CardContent className="p-0">
          {(advances?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing approved to pay.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(advances ?? []).map((a) => {
                const sup = g1<{ name: string; supplier_code: string | null; account_name: string | null; account_number: string | null; bank_name: string | null }>((a as { supplier: unknown }).supplier);
                // Prefer the account details recorded on the advance itself; fall
                // back to the supplier's stored account.
                const acctName = (a.account_name as string | null) ?? sup?.account_name ?? null;
                const acctNo = (a.account_number as string | null) ?? sup?.account_number ?? null;
                const bank = (a.bank_name as string | null) ?? sup?.bank_name ?? null;
                return (
                  <li key={a.id as string}>
                    <details className="px-4 py-3 text-sm">
                      <summary className="flex cursor-pointer items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <strong>{sup?.name ?? "—"}</strong>
                          {sup?.supplier_code && <Stamp>{sup.supplier_code}</Stamp>}
                          <span className="text-ink-2">{a.purpose as string}</span>
                        </span>
                        <span className="font-medium">{ngn(Number(a.amount_naira))}</span>
                      </summary>
                      <div className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs text-ink-2">
                        <div>Purpose: {a.purpose as string}</div>
                        <div>Pay to: {acctName ?? "—"} · <span className="mono">{acctNo ?? "—"}</span> · {bank ?? "—"}</div>
                        {a.comment ? <div>Comment: {a.comment as string}</div> : null}
                        <div>Logged: {formatTimestamp(a.created_at as string)}</div>
                      </div>
                      <form action={markAdvancePaid} className="mt-2">
                        <input type="hidden" name="advance_id" value={a.id as string} />
                        <button type="submit" className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white">Mark paid</button>
                      </form>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold">Expenses</h2></CardHeader>
        <CardContent className="p-0">
          {(expenses?.length ?? 0) === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing approved to pay.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(expenses ?? []).map((e) => (
                <li key={e.id as string}>
                  <details className="px-4 py-3 text-sm">
                    <summary className="flex cursor-pointer items-center justify-between gap-2">
                      <span>
                        <strong>{e.name as string}</strong>
                        <span className="text-ink-2"> · {String(e.category).replace(/_/g, " ")}</span>
                      </span>
                      <span className="font-medium">{e.amount_naira != null ? ngn(Number(e.amount_naira)) : "—"}</span>
                    </summary>
                    <div className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs text-ink-2">
                      <div>Category: {String(e.category).replace(/_/g, " ")}</div>
                      <div>Date: {e.entry_date as string}</div>
                      {(e.account_number || e.account_name || e.bank_name) && (
                        <div>Pay to: {(e.account_name as string | null) ?? "—"} · <span className="mono">{(e.account_number as string | null) ?? "—"}</span> · {(e.bank_name as string | null) ?? "—"}</div>
                      )}
                      {e.comment ? <div>Comment: {e.comment as string}</div> : null}
                      <div>Logged: {formatTimestamp(e.created_at as string)}</div>
                    </div>
                    <form action={markConsumablePaid} className="mt-2">
                      <input type="hidden" name="consumable_id" value={e.id as string} />
                      <button type="submit" className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white">Mark paid</button>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
