import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth/roles";

export type NotificationItem = { label: string; href: string; count: number };

type Counts = Record<string, number>;

// Which counts each role is shown, and where each one leads. Roles that share a
// queue share the entry — the counts themselves are RLS-scoped in Postgres, so
// a site manager's "in analysis" is their own site's.
const FOR_ROLE: Record<Role, { key: string; label: string; href: string }[]> = {
  owner: [
    { key: "prices_to_approve", label: "Prices to approve",         href: "/owner/approvals" },
    { key: "bulk_sales",        label: "Bulk sales to approve",     href: "/owner/approvals" },
    { key: "lot_sales",         label: "Lot sales to approve",      href: "/owner/approvals" },
    { key: "advances_pending",  label: "Advances to approve",       href: "/owner/approvals" },
    { key: "expenses_pending",  label: "Expenses to approve",       href: "/owner/approvals" },
    { key: "cost_runs",         label: "Mixing batches to approve", href: "/owner/cost-batches" },
    { key: "payments_pending",  label: "Payments to approve",       href: "/owner/approvals" },
  ],
  manager: [
    { key: "in_qc",              label: "Batches in analysis", href: "/manager" },
    { key: "awaiting_gate_exit", label: "Exits to authorise",  href: "/manager" },
    { key: "in_pricing",         label: "Visits to price",     href: "/manager" },
  ],
  accounting: [
    { key: "settlements_to_pay", label: "Settlements to pay", href: "/accounting/payouts" },
    { key: "advances_to_pay",    label: "Advances to pay",    href: "/accounting/payouts" },
    { key: "expenses_to_pay",    label: "Expenses to pay",    href: "/accounting/payouts" },
  ],
  gate: [
    { key: "passes_to_ack",      label: "Gate passes to acknowledge", href: "/gate" },
    { key: "awaiting_gate_exit", label: "Suppliers awaiting release", href: "/gate" },
  ],
  processing:  [{ key: "in_processing",   label: "Visits in processing",  href: "/processing" }],
  receiving:   [{ key: "in_receiving",    label: "Visits in receiving",   href: "/receiving" }],
  qc:          [{ key: "in_qc",           label: "Visits awaiting XRF",   href: "/qc" }],
  inventory:   [{ key: "awaiting_intake", label: "Awaiting stock intake", href: "/inventory" }],
  stock_keeper: [],
};

/**
 * Per-role "awaiting your action" counts for the header bell.
 *
 * One RPC, one row. This used to be a count query per item — seven of them for
 * the owner — re-run by every open tab on every realtime event.
 */
export async function roleNotifications(role: Role): Promise<NotificationItem[]> {
  const wanted = FOR_ROLE[role] ?? [];
  if (wanted.length === 0) return [];

  const supabase = await createClient();
  const { data } = await supabase.rpc("my_pending_counts");
  const counts = (data ?? {}) as Counts;

  return wanted
    .map((w) => ({ label: w.label, href: w.href, count: Number(counts[w.key] ?? 0) }))
    .filter((i) => i.count > 0);
}
