"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, type ActionResult } from "@/lib/actions/result";

// Owner holds an approved (not-yet-paid) payment so the accountant can't pay it
// yet. The DB transition trigger enforces owner-only + the approved → on_hold
// edge; .select() surfaces an RLS-filtered 0-row update as a failure.
export async function holdSettlement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Only the owner can hold a payment.");
  const id = String(formData.get("settlement_id") ?? "");
  if (!id) return fail("Missing settlement.");
  const supabase = await createClient();
  const res = await supabase
    .from("batch_settlements").update({ status: "on_hold" }).eq("id", id).eq("status", "approved").select("id");
  const result = fromWrite(res, "Couldn't hold this payment — it may already be paid or held.");
  if (result.ok) { revalidatePath("/owner/payments"); revalidatePath("/accounting/payouts"); }
  return result;
}

// Owner releases a held payment back onto the accountant's to-pay queue.
export async function releaseSettlement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Only the owner can release a payment.");
  const id = String(formData.get("settlement_id") ?? "");
  if (!id) return fail("Missing settlement.");
  const supabase = await createClient();
  const res = await supabase
    .from("batch_settlements").update({ status: "approved" }).eq("id", id).eq("status", "on_hold").select("id");
  const result = fromWrite(res, "Couldn't release this payment — it may not be on hold.");
  if (result.ok) { revalidatePath("/owner/payments"); revalidatePath("/accounting/payouts"); }
  return result;
}
