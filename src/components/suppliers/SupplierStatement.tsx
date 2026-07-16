import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { one as g1 } from "@/lib/db/relation";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type Entry = {
  key: string; at: string; label: string; kind: "advance" | "deduction" | "payout" | "correction";
  amount: number; dir: string; href?: string; note?: string | null;
};
const KIND_LABEL: Record<Entry["kind"], string> = {
  advance: "Advance", deduction: "Advance recovered", payout: "Supply payout", correction: "Price correction",
};
const KIND_VARIANT: Record<Entry["kind"], "yellow" | "blue" | "green" | "red"> = {
  advance: "yellow", deduction: "blue", payout: "green", correction: "red",
};

// A supplier's statement of account: every money transaction (advances,
// recoveries, supply payouts, corrections) in one traceable timeline. Each row
// links back to the visit it came from where there is one. Finance roles only.
export async function SupplierStatement({ supplierId }: { supplierId: string }) {
  const supabase = await createClient();
  const [{ data: advances }, { data: deductions }, { data: settlements }, { data: corrections }] = await Promise.all([
    supabase.from("advances").select("id, purpose, amount_naira, approval_status, created_at").eq("supplier_id", supplierId),
    supabase.from("advance_deductions").select("id, amount, notes, created_at, ref_visit_id").eq("supplier_id", supplierId),
    supabase.from("batch_settlements").select("id, net_balance, paid_at, visit:visits!inner(id, supplier_id)")
      .eq("status", "paid").eq("visits.supplier_id", supplierId),
    supabase.from("price_corrections").select("id, direction, amount, reason, created_at, visit_id").eq("supplier_id", supplierId),
  ]);

  const entries: Entry[] = [
    ...(advances ?? []).map((a): Entry => ({
      key: `a-${a.id}`, at: a.created_at as string, kind: "advance",
      label: a.purpose as string, amount: Number(a.amount_naira), dir: "to supplier",
      note: `${a.approval_status}`,
    })),
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
      };
    }),
    ...(corrections ?? []).map((c): Entry => ({
      key: `c-${c.id}`, at: c.created_at as string, kind: "correction",
      label: c.direction === "underpaid" ? "Under-paid — topped up" : "Over-paid — recoverable",
      amount: Number(c.amount), dir: c.direction === "underpaid" ? "to supplier" : "supplier owes",
      href: c.visit_id ? `/visits/${c.visit_id}` : undefined, note: c.reason as string | null,
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
              return (
                <li key={e.key}>
                  {e.href ? <Link href={e.href} className="block hover:bg-gray-50">{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
