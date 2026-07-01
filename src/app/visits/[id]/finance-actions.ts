"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

// ─── Utility charges (Phase 11 B) ────────────────────────────────────────────

export async function addUtilityCharge(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["processing", "manager", "owner"].includes(me.role)) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const amount = Number(formData.get("amount"));
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!visitId || !["light_bill", "other"].includes(kind) || !(amount > 0)) return;
  // For an "other" deduction the description is its type — require it.
  if (kind === "other" && !description) return;

  const supabase = await createClient();
  await supabase.from("utility_charges").insert({
    visit_id: visitId, kind, description, amount, recorded_by: me.id,
  });
  revalidatePath(`/visits/${visitId}`);
}

// Manager (or owner) discounts/adjusts a supplier's processing fee on an open
// visit by setting a new (lower) amount. The DB policy enforces role + site +
// open; all downstream totals already sum this amount.
export async function adjustUtilityCharge(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const chargeId = String(formData.get("charge_id") ?? "");
  const amount = Number(formData.get("amount"));
  if (!chargeId || !(amount > 0)) return;

  const supabase = await createClient();
  await supabase.from("utility_charges").update({ amount }).eq("id", chargeId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// ─── Advance deductions (Phase 11 A) ─────────────────────────────────────────

export async function recordDeduction(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "accounting", "owner"].includes(me.role)) return;

  const visitId = String(formData.get("visit_id") ?? "") || null;
  const supplierId = String(formData.get("supplier_id") ?? "");
  const amount = Number(formData.get("amount"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!supplierId || !(amount > 0)) return;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId && me.role !== "owner") return;

  // Owner has no site of their own — attach to the visit's site when present.
  let effectiveSite = siteId;
  if (!effectiveSite && visitId) {
    const { data: v } = await supabase.from("visits").select("site_id").eq("id", visitId).single();
    effectiveSite = (v?.site_id as string | null) ?? null;
  }
  if (!effectiveSite) return;

  await supabase.from("advance_deductions").insert({
    supplier_id: supplierId,
    site_id: effectiveSite,
    ref_visit_id: visitId,
    amount,
    notes,
    recorded_by: me.id,
  });
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// ─── Payment workflow (Phase 11 C) ───────────────────────────────────────────

export async function raisePaymentRequest(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["accounting", "owner"].includes(me.role)) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const amount = Number(formData.get("amount"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!visitId || !(amount > 0)) return;
  if (!["processing_fee_in", "purchase_amount_out"].includes(direction)) return;

  const supabase = await createClient();
  await supabase.from("payments").insert({
    visit_id: visitId, direction, amount, notes, status: "pending", recorded_by: me.id,
  });
  revalidatePath(`/visits/${visitId}`);
}

export async function setPaymentStatus(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!paymentId || !status) return;

  // The DB trigger enforces who may take which transition; this is just UX gating.
  const supabase = await createClient();
  await supabase.from("payments").update({ status }).eq("id", paymentId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// ─── Receipt upload (Phase 11 D) ─────────────────────────────────────────────

export async function uploadReceipt(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["accounting", "owner"].includes(me.role)) return;

  const visitId = String(formData.get("visit_id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  const file = formData.get("receipt");
  if (!paymentId || !(file instanceof File) || file.size === 0) return;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const path = `${paymentId}/${Date.now()}.${ext}`;

  const supabase = await createClient();
  // Uploaded as the signed-in user → Storage RLS applies (accounting/owner only).
  const { error } = await supabase.storage.from("receipts").upload(path, file);
  if (error) return;

  await supabase.from("payments").update({ receipt_path: path }).eq("id", paymentId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}
