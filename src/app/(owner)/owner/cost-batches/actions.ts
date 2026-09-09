"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

// Owner approves a pending mixing batch → the approval trigger removes every
// attached lot from stock (flip to sold + 'mixed_batch' ledger 'out').
//
// Two ways this genuinely refuses, and both used to be invisible: a batch that
// is no longer pending matches NO rows (someone else already ruled on it), and
// the approval trigger RAISES when a lot has already left stock in another
// batch. Either way nothing sold — so the owner must not be left reading an
// unchanged Pending list and guessing whether the click registered.
export async function approveCostBatch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Not authorized.");
  const id = String(formData.get("run_id") ?? "");
  if (!id) return fail("Missing batch.");

  const supabase = await createClient();
  const res = await supabase
    .from("cost_price_runs")
    .update({
      approval_status: "approved",
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      sold: true,
      sold_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("id");
  const result = fromWrite(res, "This batch was not approved — it may already have been approved or rejected.");
  if (!result.ok) return result;
  revalidatePath("/owner/cost-batches");
  revalidatePath("/manager/cost-price");
  return ok("Batch approved — its lots have left stock.");
}

export async function rejectCostBatch(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Not authorized.");
  const id = String(formData.get("run_id") ?? "");
  if (!id) return fail("Missing batch.");

  const supabase = await createClient();
  const res = await supabase
    .from("cost_price_runs")
    .update({
      approval_status: "rejected",
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      rejection_note: String(formData.get("note") ?? "").trim() || null,
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("id");
  const result = fromWrite(res, "This batch was not rejected — it may already have been approved or rejected.");
  if (!result.ok) return result;
  revalidatePath("/owner/cost-batches");
  revalidatePath("/manager/cost-price");
  return ok("Batch rejected.");
}
