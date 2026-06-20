import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth/roles";

export type NotificationItem = { label: string; href: string; count: number };

// Per-role "awaiting your action" counts, surfaced in the header bell. Queries
// run as the signed-in user, so RLS scopes them to the viewer's site (owner sees
// all). Only non-zero items are returned.
export async function roleNotifications(role: Role): Promise<NotificationItem[]> {
  const supabase = await createClient();
  const items: NotificationItem[] = [];

  // Run a head/count query with an equality filter, RLS-scoped to the viewer.
  const countWhere = async (table: string, column: string, value: string): Promise<number> => {
    const { count } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq(column, value);
    return count ?? 0;
  };

  const push = (label: string, href: string, count: number) => {
    if (count > 0) items.push({ label, href, count });
  };

  if (role === "owner") {
    const [bulk, lots, adv, exp, batches, settles, pays] = await Promise.all([
      countWhere("bulk_sales", "approval_status", "pending"),
      countWhere("lot_sales", "approval_status", "pending"),
      countWhere("advances", "approval_status", "pending"),
      countWhere("consumables", "approval_status", "pending"),
      countWhere("cost_price_runs", "approval_status", "pending"),
      countWhere("batch_settlements", "status", "pending"),
      countWhere("payments", "status", "pending"),
    ]);
    push("Bulk sales to approve", "/owner/approvals", bulk);
    push("Lot sales to approve", "/owner/approvals", lots);
    push("Advances to approve", "/owner/approvals", adv);
    push("Expenses to approve", "/owner/approvals", exp);
    push("Mixing batches to approve", "/owner/cost-batches", batches);
    push("Supply settlements to approve", "/owner/approvals", settles);
    push("Payments to approve", "/owner/approvals", pays);
  } else if (role === "manager") {
    const [exits, pricing] = await Promise.all([
      countWhere("visits", "state", "awaiting_gate_exit"),
      countWhere("visits", "state", "pricing"),
    ]);
    push("Exits to authorise", "/manager", exits);
    push("Visits to price", "/manager", pricing);
  } else if (role === "accounting") {
    const [settles, adv, exp] = await Promise.all([
      countWhere("batch_settlements", "status", "approved"),
      countWhere("advances", "approval_status", "approved"),
      countWhere("consumables", "approval_status", "approved"),
    ]);
    push("Settlements to pay", "/accounting/payouts", settles);
    push("Advances to pay", "/accounting/payouts", adv);
    push("Expenses to pay", "/accounting/payouts", exp);
  } else if (role === "gate") {
    const [passes, exits] = await Promise.all([
      countWhere("gate_passes", "status", "issued"),
      countWhere("visits", "state", "awaiting_gate_exit"),
    ]);
    push("Gate passes to acknowledge", "/gate", passes);
    push("Suppliers awaiting release", "/gate", exits);
  } else if (role === "processing") {
    push("Visits in processing", "/processing", await countWhere("visits", "state", "in_processing"));
  } else if (role === "receiving") {
    push("Visits in receiving", "/receiving", await countWhere("visits", "state", "in_receiving"));
  } else if (role === "qc") {
    push("Visits awaiting XRF", "/qc", await countWhere("visits", "state", "in_qc"));
  } else if (role === "inventory") {
    push("Awaiting stock intake", "/inventory", await countWhere("visits", "state", "awaiting_stock_intake"));
  }

  return items;
}
