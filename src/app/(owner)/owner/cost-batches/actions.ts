"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Owner approves a pending mixing batch → the approval trigger removes every
// attached lot from stock (flip to sold + 'mixed_batch' ledger 'out').
export async function approveCostBatch(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const id = String(formData.get("run_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("cost_price_runs")
    .update({
      approval_status: "approved",
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      sold: true,
      sold_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("approval_status", "pending");
  revalidatePath("/owner/cost-batches");
  revalidatePath("/manager/cost-price");
}

export async function rejectCostBatch(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const id = String(formData.get("run_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("cost_price_runs")
    .update({
      approval_status: "rejected",
      approved_by: me.id,
      approved_at: new Date().toISOString(),
      rejection_note: String(formData.get("note") ?? "").trim() || null,
    })
    .eq("id", id)
    .eq("approval_status", "pending");
  revalidatePath("/owner/cost-batches");
  revalidatePath("/manager/cost-price");
}
