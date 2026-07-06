"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// Manager records an advance for a supplier (marked to that supplier). Created
// pending; the owner approves it before it counts toward the supplier's debt.
export async function recordAdvance(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;

  const supplierId = String(formData.get("supplier_id") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const amount = Number(formData.get("amount_naira"));
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const accountNumber = String(formData.get("account_number") ?? "").trim() || null;
  if (!supplierId || !purpose || !(amount > 0)) return;
  // Account number, when given, must be exactly 10 digits (all positive integers).
  if (accountNumber && !/^\d{10}$/.test(accountNumber)) return;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId) return; // owner provisions advances per-site via the supplier profile instead

  await supabase.from("advances").insert({
    supplier_id: supplierId, site_id: siteId, purpose, amount_naira: amount,
    comment, account_number: accountNumber, recorded_by: me.id,
  });
  revalidatePath("/manager/advances");
}

// Manager (own site) deletes a still-pending advance; owner may delete any. RLS
// enforces the manager can only delete their own site's pending advances.
export async function deleteAdvance(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return;
  const id = String(formData.get("advance_id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("advances").delete().eq("id", id);
  revalidatePath("/manager/advances");
}

// Owner approves / rejects an advance (so it counts toward — or is removed from
// — the supplier debt balance).
export async function setAdvanceApproval(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return;
  const id = String(formData.get("advance_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || !["approved", "rejected"].includes(decision)) return;
  const supabase = await createClient();
  await supabase.from("advances").update({ approval_status: decision }).eq("id", id);
  revalidatePath("/manager/advances");
}
