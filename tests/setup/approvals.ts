import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 0162 (F-09): approval is version-checked, so a decision must name the exact
 * revision it reviewed. A direct table UPDATE to approved/rejected is refused
 * with ST001 for every caller — the service role included — so tests drive
 * approvals the way the screens do: read the current revision, call the RPC.
 *
 * The client passed in must be an OWNER client; approval authority is unchanged.
 * Fixtures that only need a row to START in a ruled state should insert it with
 * that approval_status instead of transitioning into it.
 */
async function review(
  client: SupabaseClient,
  table: "advances" | "consumables",
  rpc: "review_advance" | "review_expense",
  id: string,
  decision: "approved" | "rejected",
) {
  const { data } = await client.from(table).select("revision").eq("id", id).single();
  return client.rpc(rpc, {
    p_id: id,
    p_reviewed_revision: (data as { revision: number } | null)?.revision ?? -1,
    p_decision: decision,
  });
}

export const reviewAdvanceAs = (
  client: SupabaseClient, id: string, decision: "approved" | "rejected" = "approved",
) => review(client, "advances", "review_advance", id, decision);

export const reviewExpenseAs = (
  client: SupabaseClient, id: string, decision: "approved" | "rejected" = "approved",
) => review(client, "consumables", "review_expense", id, decision);

/**
 * 0162: approve_pricing takes the fingerprint of every financial source the
 * settlement will freeze (lines, utility charges, the visit's deductions and
 * the supplier debt). Tests read it immediately before approving, which is what
 * an owner looking at a fresh screen does.
 */
export async function approvePricingAs(client: SupabaseClient, visitId: string) {
  const { data: token } = await client.rpc("pricing_review_token", { p_visit_id: visitId });
  return client.rpc("approve_pricing", {
    p_visit_id: visitId, p_reviewed_token: (token as string | null) ?? "",
  });
}

/** 0162: same contract for a cost-price run (membership, lots, extras). */
export async function approveCostRunAs(client: SupabaseClient, runId: string) {
  const { data: token } = await client.rpc("cost_price_review_token", { p_run_id: runId });
  return client.rpc("approve_cost_price_run", {
    p_run_id: runId, p_reviewed_token: (token as string | null) ?? "",
  });
}
