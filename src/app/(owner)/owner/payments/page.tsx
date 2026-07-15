import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/visits/format";
import { holdSettlement, releaseSettlement } from "./actions";
import { HoldReleaseButton } from "@/components/owner/HoldReleaseButton";
import { one as g1 } from "@/lib/db/relation";

const ngn = (n: number) => `₦${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// Owner's record of the supplier payments they approved, and where each one
// stands: waiting on the accountant, held by the owner, or paid. From here the
// owner can hold a payment (pull it off the accountant's queue) or release it.
export default async function OwnerPaymentsPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("batch_settlements")
    .select("id, visit_id, net_balance, status, approved_at, paid_at, held_at, site:sites(name), visit:visits(supplier:suppliers(name, supplier_code))")
    .in("status", ["approved", "on_hold", "paid"])
    .order("approved_at", { ascending: false });

  const all = rows ?? [];
  const awaiting = all.filter((r) => r.status === "approved");
  const held = all.filter((r) => r.status === "on_hold");
  const paid = all.filter((r) => r.status === "paid");

  const supName = (r: (typeof all)[number]) =>
    g1<{ name: string }>(g1<{ supplier: unknown }>((r as { visit: unknown }).visit)?.supplier)?.name ?? "—";
  const siteName = (r: (typeof all)[number]) => g1<{ name: string }>((r as { site: unknown }).site)?.name ?? "—";

  const total = (list: typeof all) => list.reduce((s, r) => s + Number(r.net_balance), 0);

  function Row({ r, action }: { r: (typeof all)[number]; action?: "hold" | "release" }) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
        <span>
          <Link href={`/visits/${r.visit_id}`} className="font-medium underline">{supName(r)}</Link>
          <span className="text-ink-2"> · {siteName(r)} · {ngn(Number(r.net_balance))}</span>
          <span className="block text-xs text-ink-2">
            Approved {r.approved_at ? formatTimestamp(r.approved_at as string) : "—"}
            {r.status === "paid" && r.paid_at ? ` · Paid ${formatTimestamp(r.paid_at as string)}` : ""}
            {r.status === "on_hold" && r.held_at ? ` · Held ${formatTimestamp(r.held_at as string)}` : ""}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant={r.status === "paid" ? "green" : r.status === "on_hold" ? "yellow" : "blue"}>
            {r.status === "paid" ? "Paid" : r.status === "on_hold" ? "On hold" : "Awaiting accountant"}
          </Badge>
          {action === "hold" && <HoldReleaseButton action={holdSettlement} id={r.id as string} label="Hold" variant="hold" />}
          {action === "release" && <HoldReleaseButton action={releaseSettlement} id={r.id as string} label="Release" variant="release" />}
        </span>
      </li>
    );
  }

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/owner" className="text-sm text-gray-500 hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold">Approved payments</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Awaiting accountant</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ink">{ngn(total(awaiting))}</div><p className="text-xs text-ink-2">{awaiting.length} payment{awaiting.length !== 1 ? "s" : ""}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">On hold</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ore">{ngn(total(held))}</div><p className="text-xs text-ink-2">{held.length} payment{held.length !== 1 ? "s" : ""}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="text-sm font-semibold">Paid</h2></CardHeader>
          <CardContent><div className="mono text-2xl font-bold text-ink">{ngn(total(paid))}</div><p className="text-xs text-ink-2">{paid.length} payment{paid.length !== 1 ? "s" : ""}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Awaiting the accountant</h2>
            <Badge variant={awaiting.length ? "blue" : "default"}>{awaiting.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {awaiting.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing waiting to be paid.</p>
          ) : (
            <ul className="divide-y divide-line">{awaiting.map((r) => <Row key={r.id as string} r={r} action="hold" />)}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">On hold (you paused these)</h2>
            <Badge variant={held.length ? "yellow" : "default"}>{held.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {held.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">No payments on hold.</p>
          ) : (
            <ul className="divide-y divide-line">{held.map((r) => <Row key={r.id as string} r={r} action="release" />)}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Paid</h2>
            <Badge variant={paid.length ? "green" : "default"}>{paid.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {paid.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-2">Nothing paid yet.</p>
          ) : (
            <ul className="divide-y divide-line">{paid.map((r) => <Row key={r.id as string} r={r} />)}</ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
