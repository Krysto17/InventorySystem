import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { PayableControls } from "@/components/payables/PayableControls";
import { RecordPaymentForm } from "@/components/visits/RecordPaymentForm";
import { one as g1 } from "@/lib/db/relation";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

type Kind = "settlement" | "advance" | "expense";
type Item = {
  kind: Kind; id: string; label: string; sub: string; amount: number;
  status: string; href?: string; heldBy?: string | null; heldAt?: string | null; note?: string | null;
  visitId?: string; remaining?: number;
};
const KIND_LABEL: Record<Kind, string> = { settlement: "Supplier", advance: "Advance", expense: "Expense" };
const KIND_VARIANT: Record<Kind, "blue" | "yellow" | "default"> = { settlement: "blue", advance: "yellow", expense: "default" };

// Shared payables console: approved items you can hold/send-back, items on hold,
// and advances/expenses returned to the manager for correction. RLS scopes the
// rows to what the viewer may read (owner/GM/GA: all sites; site roles: own).
export async function PayablesReview({
  canManage,
  includeApproved = true,
  includeReturned = true,
  heldTitle = "On hold",
}: {
  canManage: boolean;
  includeApproved?: boolean;
  includeReturned?: boolean;
  heldTitle?: string;
}) {
  const supabase = await createClient();
  // Settlements can also be part-paid (the manager pays cash toward them).
  const settleStatuses = includeApproved ? ["approved", "partially_paid", "on_hold"] : ["on_hold"];
  const otherStatuses = includeApproved ? ["approved", "on_hold"] : ["on_hold"];

  const [{ data: settlements }, { data: advances }, { data: expenses }, { data: returnedAdv }, { data: returnedExp }] =
    await Promise.all([
      supabase.from("batch_settlements")
        .select("id, visit_id, net_balance, status, held_at, held_by_p:profiles!batch_settlements_held_by_fkey(full_name), visit:visits(supplier:suppliers(name)), site:sites(name)")
        .in("status", settleStatuses).order("approved_at", { ascending: false }),
      supabase.from("advances")
        .select("id, purpose, amount_naira, approval_status, held_at, held_by_p:profiles!advances_held_by_fkey(full_name), supplier:suppliers(name), site:sites(name)")
        .in("approval_status", otherStatuses).order("created_at", { ascending: false }),
      supabase.from("consumables")
        .select("id, name, category, amount_naira, approval_status, held_at, held_by_p:profiles!consumables_held_by_fkey(full_name), site:sites(name)")
        .in("approval_status", otherStatuses).order("entry_date", { ascending: false }),
      includeReturned
        ? supabase.from("advances").select("id, purpose, amount_naira, correction_note, supplier:suppliers(name), site:sites(name)")
            .eq("approval_status", "pending").not("correction_note", "is", null).order("updated_at", { ascending: false })
        : Promise.resolve({ data: [] as unknown[] }),
      includeReturned
        ? supabase.from("consumables").select("id, name, category, amount_naira, correction_note, site:sites(name)")
            .eq("approval_status", "pending").not("correction_note", "is", null).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  const heldByName = (r: unknown) => g1<{ full_name?: string }>((r as { held_by_p: unknown }).held_by_p)?.full_name ?? null;
  const siteName = (r: unknown) => g1<{ name: string }>((r as { site: unknown }).site)?.name ?? "—";

  // Payments already recorded against each settlement → remaining to pay.
  const settlementIds = (settlements ?? []).map((s) => s.id as string);
  const { data: paidRows } = settlementIds.length
    ? await supabase.from("settlement_payments").select("settlement_id, amount").in("settlement_id", settlementIds)
    : { data: [] as { settlement_id: string; amount: number }[] };
  const paidBy = new Map<string, number>();
  for (const p of paidRows ?? []) paidBy.set(p.settlement_id as string, (paidBy.get(p.settlement_id as string) ?? 0) + Number(p.amount));

  const items: Item[] = [
    ...(settlements ?? []).map((s): Item => {
      const remaining = Math.max(Number(s.net_balance) - (paidBy.get(s.id as string) ?? 0), 0);
      return {
        kind: "settlement", id: s.id as string,
        label: g1<{ name: string }>(g1<{ supplier: unknown }>((s as { visit: unknown }).visit)?.supplier)?.name ?? "—",
        sub: siteName(s), amount: remaining, status: s.status as string,
        href: `/visits/${s.visit_id}`, heldBy: heldByName(s), heldAt: s.held_at as string | null,
        visitId: s.visit_id as string, remaining,
      };
    }),
    ...(advances ?? []).map((a): Item => ({
      kind: "advance", id: a.id as string,
      label: g1<{ name: string }>((a as { supplier: unknown }).supplier)?.name ?? "—",
      sub: `${a.purpose as string} · ${siteName(a)}`, amount: Number(a.amount_naira),
      status: a.approval_status as string, heldBy: heldByName(a), heldAt: a.held_at as string | null,
    })),
    ...(expenses ?? []).map((e): Item => ({
      kind: "expense", id: e.id as string,
      label: e.name as string, sub: `${String(e.category).replace(/_/g, " ")} · ${siteName(e)}`,
      amount: Number(e.amount_naira), status: e.approval_status as string,
      heldBy: heldByName(e), heldAt: e.held_at as string | null,
    })),
  ];
  // Awaiting = anything not on hold (approved, or a part-paid settlement).
  const approved = items.filter((i) => i.status !== "on_hold");
  const held = items.filter((i) => i.status === "on_hold");

  const returned: Item[] = [
    ...((returnedAdv ?? []) as Record<string, unknown>[]).map((a): Item => ({
      kind: "advance", id: a.id as string,
      label: g1<{ name: string }>((a as { supplier: unknown }).supplier)?.name ?? "—",
      sub: a.purpose as string, amount: Number(a.amount_naira), status: "approved",
      href: "/manager/advances", note: a.correction_note as string | null,
    })),
    ...((returnedExp ?? []) as Record<string, unknown>[]).map((e): Item => ({
      kind: "expense", id: e.id as string, label: e.name as string,
      sub: String(e.category).replace(/_/g, " "), amount: Number(e.amount_naira), status: "approved",
      href: "/inventory/consumables", note: e.correction_note as string | null,
    })),
  ];

  function Line({ i, showControls }: { i: Item; showControls: boolean }) {
    const partPaid = i.kind === "settlement" && i.status === "partially_paid";
    // Record-payment (manager cash / etc.) on a settlement that's still owed;
    // hold/send-back only while it's fully approved (a part-paid one can't).
    const canPay = showControls && i.kind === "settlement" && i.visitId != null && (i.remaining ?? 0) > 0.005
      && (i.status === "approved" || i.status === "partially_paid");
    const canHold = showControls && (i.status === "approved" || i.status === "on_hold");
    return (
      <li className="px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <Badge variant={KIND_VARIANT[i.kind]}>{KIND_LABEL[i.kind]}</Badge>
              {i.href ? <Link href={i.href} className="font-medium underline">{i.label}</Link> : <span className="font-medium">{i.label}</span>}
              <span className="font-semibold">{ngn(i.amount)}{partPaid ? " left" : ""}</span>
              {partPaid && <Badge variant="blue">part-paid</Badge>}
            </span>
            <span className="block text-xs text-ink-2">{i.sub}
              {i.heldBy ? ` · held by ${i.heldBy}${i.heldAt ? ` · ${formatTimestamp(i.heldAt)}` : ""}` : ""}
              {i.note ? ` · “${i.note}”` : ""}
            </span>
          </span>
          {canHold && <PayableControls kind={i.kind} id={i.id} status={i.status as "approved" | "on_hold"} />}
        </div>
        {canPay && (
          <div className="mt-1">
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-ink-2 hover:underline">Record a payment</summary>
              <RecordPaymentForm visitId={i.visitId!} settlementId={i.id} remaining={i.remaining!} />
            </details>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      {includeApproved && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Awaiting payment</h2>
              <Badge variant={approved.length ? "blue" : "default"}>{approved.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {approved.length === 0 ? <p className="px-4 py-3 text-sm text-ink-2">Nothing awaiting payment.</p> : (
              <ul className="divide-y divide-line">{approved.map((i) => <Line key={`${i.kind}-${i.id}`} i={i} showControls={canManage} />)}</ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{heldTitle}</h2>
            <Badge variant={held.length ? "yellow" : "default"}>{held.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {held.length === 0 ? <p className="px-4 py-3 text-sm text-ink-2">No payments on hold.</p> : (
            <ul className="divide-y divide-line">{held.map((i) => <Line key={`${i.kind}-${i.id}`} i={i} showControls={canManage} />)}</ul>
          )}
        </CardContent>
      </Card>

      {includeReturned && returned.length > 0 && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Returned for correction</h2></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-line">{returned.map((i) => <Line key={`ret-${i.kind}-${i.id}`} i={i} showControls={false} />)}</ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
