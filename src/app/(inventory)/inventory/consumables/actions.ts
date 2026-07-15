"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { CONSUMABLE_CATEGORIES, type ConsumableCategory } from "./categories";

export async function createConsumable(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;
  if (!["inventory", "manager", "owner"].includes(me.role)) return;

  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "") as ConsumableCategory;
  const entryDate = String(formData.get("entry_date") ?? "").trim() || null;
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const amountRaw = String(formData.get("amount_naira") ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);
  const accountName = String(formData.get("account_name") ?? "").trim() || null;
  const accountNumber = String(formData.get("account_number") ?? "").trim() || null;
  const bankName = String(formData.get("bank_name") ?? "").trim() || null;
  if (!name) return;
  if (!CONSUMABLE_CATEGORIES.includes(category)) return;
  // Account number, when given, must be exactly 10 digits (all positive integers).
  if (accountNumber && !/^\d{10}$/.test(accountNumber)) return;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("site_id")
    .eq("id", me.id)
    .single();

  const siteId = profile?.site_id as string | null;
  if (!siteId) return;

  await supabase.from("consumables").insert({
    site_id: siteId,
    name,
    category,
    entry_date: entryDate ?? undefined,
    comment,
    amount_naira: amount,
    account_name: accountName,
    account_number: accountNumber,
    bank_name: bankName,
    recorded_by: me.id,
  });

  revalidatePath("/inventory/consumables");
}

// Manager (own site) / owner / general manager deletes an expense before it is
// paid. RLS re-checks the role + site + not-paid; a paid expense can't be removed.
export async function deleteConsumable(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return;
  const id = String(formData.get("consumable_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("consumables").delete().eq("id", id);
  revalidatePath("/inventory/consumables");
}

// Owner approves / rejects a submitted expense (DB trigger enforces owner-only).
export async function reviewExpense(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;

  const id = String(formData.get("consumable_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || !["approved", "rejected"].includes(decision)) return;

  const supabase = await createClient();
  await supabase.from("consumables").update({ approval_status: decision }).eq("id", id);
  revalidatePath("/inventory/consumables");
}
