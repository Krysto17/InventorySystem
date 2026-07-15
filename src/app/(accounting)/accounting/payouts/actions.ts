"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, type ActionResult } from "@/lib/actions/result";

// Only the accountant executes payment. The DB triggers enforce the
// approved → paid transition + role; these surface failures (incl. an
// RLS-filtered 0-row update) to the UI instead of silently no-op'ing.
export async function markAdvancePaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("advance_id") ?? "");
  if (!id) return fail("Missing advance.");
  const supabase = await createClient();
  const res = await supabase.from("advances").update({ approval_status: "paid" }).eq("id", id).select("id");
  const result = fromWrite(res, "Couldn't mark this advance paid — check you have access to its site.");
  if (result.ok) revalidatePath("/accounting/payouts");
  return result;
}

export async function markConsumablePaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("consumable_id") ?? "");
  if (!id) return fail("Missing expense.");
  const supabase = await createClient();
  const res = await supabase.from("consumables").update({ approval_status: "paid" }).eq("id", id).select("id");
  const result = fromWrite(res, "Couldn't mark this expense paid — check you have access to its site.");
  if (result.ok) revalidatePath("/accounting/payouts");
  return result;
}

export async function markSettlementPaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("settlement_id") ?? "");
  if (!id) return fail("Missing settlement.");
  const supabase = await createClient();
  // Pay the full remaining balance in one go (net − already-recorded payments).
  const [{ data: st }, { data: paidTotal }] = await Promise.all([
    supabase.from("batch_settlements").select("net_balance").eq("id", id).maybeSingle(),
    supabase.rpc("settlement_paid_total", { p_settlement_id: id }),
  ]);
  if (!st) return fail("Couldn't load this settlement — check you have access to its site.");
  const remaining = Number(st.net_balance) - Number(paidTotal ?? 0);
  if (!(remaining > 0.005)) return fail("Nothing left to pay on this settlement.");
  const { error } = await supabase.rpc("record_settlement_payment", {
    p_settlement_id: id, p_amount: remaining, p_method: "transfer",
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/accounting/payouts");
  return { ok: true };
}

// An underpaid price correction is a compensation the accountant disburses to
// the supplier. The RPC enforces accounting-only + site + unpaid-underpaid.
export async function markCorrectionPaid(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return fail("Only accounting can mark items paid.");
  const id = String(formData.get("correction_id") ?? "");
  if (!id) return fail("Missing correction.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_price_correction_paid", { p_id: id });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/accounting/payouts");
  return { ok: true };
}
