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
  const res = await supabase.from("batch_settlements").update({ status: "paid" }).eq("id", id).select("id");
  const result = fromWrite(res, "Couldn't mark this settlement paid — check you have access to its site.");
  if (result.ok) revalidatePath("/accounting/payouts");
  return result;
}
