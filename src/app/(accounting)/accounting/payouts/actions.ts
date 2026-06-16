"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Only the accountant executes payment. The DB triggers enforce the
// approved → paid transition + role; these are the UI entry points.
export async function markAdvancePaid(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return;
  const id = String(formData.get("advance_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("advances").update({ approval_status: "paid" }).eq("id", id);
  revalidatePath("/accounting/payouts");
}

export async function markConsumablePaid(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return;
  const id = String(formData.get("consumable_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("consumables").update({ approval_status: "paid" }).eq("id", id);
  revalidatePath("/accounting/payouts");
}

export async function markSettlementPaid(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "accounting") return;
  const id = String(formData.get("settlement_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("batch_settlements").update({ status: "paid" }).eq("id", id);
  revalidatePath("/accounting/payouts");
}
