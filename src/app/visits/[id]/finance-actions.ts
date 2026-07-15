"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";

// Owner / general manager records a price correction on a paid visit (the
// supplier's material turned out over- or under-priced). The RPC enforces the
// role + that the settlement was paid; the paid settlement is left untouched.
export async function recordPriceCorrection(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) {
    return fail("Only the owner or general manager can record a correction.");
  }
  const visitId = String(formData.get("visit_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const amount = Number(formData.get("amount"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!visitId) return fail("Missing visit.");
  if (!["overpaid", "underpaid"].includes(direction)) return fail("Pick over- or under-paid.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_price_correction", {
    p_visit_id: visitId, p_direction: direction, p_amount: amount, p_reason: reason ?? undefined,
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  return ok();
}

// Accounting returns an owner-approved (not-yet-paid) batch to the OWNER for
// review (accounting → owner → manager). The RPC voids the approved settlement,
// unlocks the line prices, returns the visit to 'awaiting_price_approval', and
// posts the reason to the batch thread. The owner then re-approves or sends it
// on to the manager. Enforces accounting-only + site + not-paid in the DB.
export async function sendBackToOwner(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !(me.role === "accounting" || me.role === "owner")) {
    return fail("Only accounting can send a batch back for review.");
  }
  const visitId = String(formData.get("visit_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!visitId) return fail("Missing visit.");
  if (!reason) return fail("Give the owner a reason for the review.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("accountant_send_back_to_owner", {
    p_visit_id: visitId, p_reason: reason,
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting");
  revalidatePath("/owner/approvals");
  revalidatePath("/owner");
  return ok();
}

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

// Manager/owner sends the processing fee back to the processing employee for
// correction (reopen in place — the visit stays where it is).
export async function reopenProcessingFee(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return;
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return;
  const supabase = await createClient();
  await supabase.rpc("reopen_processing_fee", { p_visit_id: visitId });
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/processing");
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

// Manager/accounting/owner removes an advance deduction applied by mistake. The
// supplier's outstanding debt is recomputed automatically. Blocked once the
// batch is paid (locked).
export async function removeDeduction(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "accounting", "owner"].includes(me.role)) return;
  const visitId = String(formData.get("visit_id") ?? "") || null;
  const deductionId = String(formData.get("deduction_id") ?? "");
  if (!deductionId) return;

  const supabase = await createClient();
  if (visitId) {
    const { data: st } = await supabase.from("batch_settlements").select("status").eq("visit_id", visitId).maybeSingle();
    if (st?.status === "paid") return; // already disbursed — locked
  }
  await supabase.from("advance_deductions").delete().eq("id", deductionId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}

// Manager/owner removes a utility deduction (processing fee / other charge)
// applied by mistake, while the visit is still open.
export async function removeUtilityCharge(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return;
  const visitId = String(formData.get("visit_id") ?? "") || null;
  const chargeId = String(formData.get("charge_id") ?? "");
  if (!chargeId) return;

  const supabase = await createClient();
  await supabase.from("utility_charges").delete().eq("id", chargeId);
  if (visitId) revalidatePath(`/visits/${visitId}`);
}
