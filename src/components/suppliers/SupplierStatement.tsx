import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";
import { PaymentBreakdown, type PaymentRow, type PlanRow } from "@/components/payments/PaymentBreakdown";
import { fetchPaymentsBySettlement, fetchPayoutPlansByVisit } from "@/lib/payments/breakdown";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type Entry = {
  key: string; at: string; label: string; kind: "advance" | "deduction" | "payout" | "correction" | "lightbill" | "overpayment";
  amount: number; dir: string; href?: string; note?: string | null;
  // Only a payout carries these: the individual payments that made it up, so a
  // split payout can say which account each part went into, plus the manager's
  // plan for the older payouts whose ledger never recorded the accounts.
  payments?: PaymentRow[];
  plan?: PlanRow[];
};
const KIND_LABEL: Record<Entry["kind"], string> = {
  advance: "Advance", deduction: "Advance recovered", payout: "Supply payout", correction: "Price correction",
  lightbill: "Light bill (carried)", overpayment: "Overpayment",
};
const KIND_VARIANT: Record<Entry["kind"], "yellow" | "blue" | "green" | "red" | "default"> = {
  advance: "yellow", deduction: "blue", payout: "green", correction: "red", lightbill: "default", overpayment: "red",
};

// A supplier's statement of account: every money transaction (advances,
// recoveries, supply payouts, corrections) in one traceable timeline. Each row
// links back to the visit it came from where there is one. Finance roles only.
export async function SupplierStatement({ supplierId }: { supplierId: string }) {
  const supabase = await createClient();
  const [{ data: advances }, { data: deductions }, { data: settlements }, { data: corrections }, { data: lightBills }] = await Promise.all([
    supabase.from("advances").select("id, purpose, amount_naira, approval_status, created_at").eq("supplier_id", supplierId),
    supabase.from("advance_deductions").select("id, amount, notes, created_at, ref_visit_id").eq("supplier_id", supplierId),
    supabase.from("batch_settlements").select("id, net_balance, paid_at, visit:visits!inner(id, supplier_id)")
      .eq("status", "paid").eq("visits.supplier_id", supplierId),
    supabase.from("price_corrections").select("id, direction, amount, reason, created_at, visit_id").eq("supplier_id", supplierId),
    supabase.from("utility_charges").select("id, amount, created_at, visit_id, visit:visits!inner(supplier_id)")
      .eq("kind", "light_bill").eq("carried", true).eq("visits.supplier_id", supplierId),
  ]);

  // A payout is often split across several accounts, and this statement is the
  // place a manager or the owner goes to answer a supplier's "where did my money
  // go?" long after the settlement was closed. Carry the parts, not just the sum.
  const [paymentsBy, plansBy] = await Promise.all([
    fetchPaymentsBySettlement(supabase, (settlements ?? []).map((s) => s.id as string)),
    fetchPayoutPlansByVisit(
      supabase,
      (settlements ?? []).map((s) => g1<{ id: string }>((s as { visit: unknown }).visit)?.id ?? ""),
    ),
  ]);

  const entries: Entry[] = [
    ...(advances ?? []).map((a): Entry => {
      const overpay = (a.purpose as string)?.startsWith("Overpayment");
      return {
        key: `a-${a.id}`, at: a.created_at as string, kind: overpay ? "overpayment" : "advance",
        label: overpay ? (a.purpose as string) : (a.purpose as string),
        amount: Number(a.amount_naira), dir: overpay ? "supplier owes" : "to supplier",
        note: `${a.approval_status}`,
      };
    }),
    ...(deductions ?? []).map((d): Entry => ({
      key: `d-${d.id}`, at: d.created_at as string, kind: "deduction",
      label: (d.notes as string | null) ?? "Advance recovered", amount: Number(d.amount), dir: "recovered",
      href: d.ref_visit_id ? `/visits/${d.ref_visit_id}` : undefined,
    })),
    ...(settlements ?? []).map((s): Entry => {
      const vid = g1<{ id: string }>((s as { visit: unknown }).visit)?.id;
      return {
        key: `s-${s.id}`, at: (s.paid_at as string) ?? "", kind: "payout",
        label: "Supply paid", amount: Number(s.net_balance), dir: "to supplier",
        href: vid ? `/visits/${vid}` : undefined,
        payments: paymentsBy.get(s.id as string) ?? [],
        plan: vid ? plansBy.get(vid) ?? [] : [],
      };
    }),
    ...(corrections ?? []).map((c): Entry => ({
      key: `c-${c.id}`, at: c.created_at as string, kind: "correction",
      label: c.direction === "underpaid" ? "Under-paid — topped up" : "Over-paid — recoverable",
      amount: Number(c.amount), dir: c.direction === "underpaid" ? "to supplier" : "supplier owes",
      href: c.visit_id ? `/visits/${c.visit_id}` : undefined, note: c.reason as string | null,
    })),
    ...(lightBills ?? []).map((l): Entry => ({
      key: `l-${l.id}`, at: l.created_at as string, kind: "lightbill",
      label: "Dressing / light bill", amount: Number(l.amount), dir: "supplier owes",
      href: l.visit_id ? `/visits/${l.visit_id}` : undefined,
    })),
  ]
    .filter((e) => e.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <Card>
      <CardHeader><h2 className="text-sm font-semibold">Statement of account ({entries.length})</h2></CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-2">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => {
              const inner = (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Badge variant={KIND_VARIANT[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
                      <span className="font-medium">{e.label}</span>
                    </span>
                    <span className="block text-xs text-ink-2">
                      {formatTimestamp(e.at)} · {e.dir}{e.note ? ` · ${e.note}` : ""}
                    </span>
                  </span>
                  <span className="font-semibold">{ngn(e.amount)}</span>
                </div>
              );
              const parts = e.payments ?? [];
              const plan = e.plan ?? [];
              return (
                <li key={e.key}>
                  {e.href ? <Link href={e.href} className="block hover:bg-gray-50">{inner}</Link> : inner}
                  {/* Outside the link on purpose — a <details> nested in an
                      anchor gets swallowed by the navigation on click. */}
                  {(parts.length > 0 || plan.length > 0) && (
                    <details className="px-4 pb-2.5">
                      <summary className="cursor-pointer text-xs text-ink-2 hover:underline">
                        {parts.length > 1
                          ? `Split across ${parts.length} payments — which account(s) it went into`
                          : "Which account it went into"}
                      </summary>
                      <div className="mt-1.5 rounded border border-line">
                        <PaymentBreakdown payments={parts} plan={plan} />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
