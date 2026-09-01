"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";
import { accountTrioFromForm } from "@/lib/validation/account";
import { revalidateSupplierFinance } from "@/lib/finance/revalidate";

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

// Record a payment (part or full) against an approved settlement. Cash is
// typically paid by the manager; the accountant records transfers. The RPC
// enforces role + site + open status + no over-payment, and derives the
// settlement status (partially_paid / paid).
export async function recordSettlementPayment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["owner", "accounting", "manager"].includes(me.role)) {
    return fail("Not allowed to record a payment.");
  }
  const visitId = String(formData.get("visit_id") ?? "");
  const settlementId = String(formData.get("settlement_id") ?? "");
  const amount = Number(formData.get("amount"));
  const method = String(formData.get("method") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!settlementId) return fail("Missing settlement.");
  if (!["cash", "transfer", "other"].includes(method)) return fail("Pick a payment method.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  // Which account this portion was paid into (a payout may be split across
  // several accounts — one payment row each). Optional, but complete if given.
  const acct = accountTrioFromForm(formData);
  if (!acct.ok) return fail(acct.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_settlement_payment", {
    p_settlement_id: settlementId, p_amount: amount, p_method: method, p_note: note ?? undefined,
    p_account_name: acct.value.account_name ?? undefined,
    p_account_number: acct.value.account_number ?? undefined,
    p_bank_name: acct.value.bank_name ?? undefined,
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting/payouts");
  revalidatePath("/owner/payments");
  revalidatePath("/manager/payments");
  return ok();
}

// Close a fully-covered (₦0 remaining) settlement — mark it paid without a
// ledger entry. The RPC enforces role + site + that nothing is left to pay.
export async function closeSettlement(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["owner", "accounting", "manager"].includes(me.role)) return fail("Not allowed to close a settlement.");
  const visitId = String(formData.get("visit_id") ?? "");
  const settlementId = String(formData.get("settlement_id") ?? "");
  if (!settlementId) return fail("Missing settlement.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_settlement", { p_id: settlementId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting/payouts");
  revalidatePath("/owner/payments");
  revalidatePath("/manager/payments");
  return ok();
}

// Close a processing visit as "dressing only" — the customer dressed material
// for the light bill but isn't supplying here. Carries the light bill to their
// account (recoverable from a later supply or payable in cash) and exits.
export async function closeDressingOnly(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["processing", "manager", "owner"].includes(me.role)) return fail("Not allowed to close this visit.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing visit.");
  const carry = String(formData.get("carry") ?? "") === "1"; // "1" = carry to account, else paid cash
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_dressing_only", { p_visit_id: visitId, p_carry: carry });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/processing");
  revalidatePath("/receiving");
  revalidatePath("/manager");
  // A carried light bill becomes processing debt on the customer's account.
  revalidateSupplierFinance();
  return ok();
}

// Accountant reverses a paid supply after confirming a supplier refund: rolls
// the intake out of stock, voids the settlement, and returns the visit to
// pricing. The RPC blocks it if any material has already left stock.
export async function reversePaidSupply(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !(me.role === "accounting" || me.role === "owner")) return fail("Only accounting can reverse a paid supply.");
  const visitId = String(formData.get("visit_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!visitId) return fail("Missing visit.");
  if (!reason) return fail("Confirm the refund with a reason.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_paid_supply", { p_visit_id: visitId, p_reason: reason });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting");
  revalidatePath("/manager");
  return ok();
}

// ─── Payout split plan (manager declares, accountant pays against it) ────────

// Manager/owner plans an exact figure to send to a given account. Several splits
// make up the payout; the DB blocks a plan that exceeds it.
export async function addPayoutSplit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Only the manager or owner can plan the split.");
  const visitId = String(formData.get("visit_id") ?? "");
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!visitId) return fail("Missing visit.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  const acct = accountTrioFromForm(formData);
  if (!acct.ok) return fail(acct.error);
  if (!acct.value.account_name) return fail("Enter the account to pay this portion into.");

  const supabase = await createClient();
  // The plan hangs off the visit, so the manager can set it while pricing —
  // before the owner approves and a settlement exists.
  const [{ data: v }, { data: st }] = await Promise.all([
    supabase.from("visits").select("site_id").eq("id", visitId).maybeSingle(),
    supabase.from("batch_settlements").select("id").eq("visit_id", visitId).maybeSingle(),
  ]);
  if (!v) return fail("Couldn't load this visit.");

  const { error } = await supabase.from("settlement_payout_splits").insert({
    visit_id: visitId, settlement_id: (st?.id as string | undefined) ?? null,
    site_id: v.site_id as string, amount, note,
    account_name: acct.value.account_name,
    account_number: acct.value.account_number!,
    bank_name: acct.value.bank_name!,
    created_by: me.id,
  });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting/payouts");
  return ok("Split added.");
}

export async function removePayoutSplit(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not allowed to change the payout plan.");
  const visitId = String(formData.get("visit_id") ?? "");
  const id = String(formData.get("split_id") ?? "");
  if (!id) return fail("Missing split.");
  const supabase = await createClient();
  // .select() so a row RLS refused comes back as zero rows rather than silence.
  const res = await supabase.from("settlement_payout_splits").delete().eq("id", id).select("id");
  const result = fromWrite(res, "That split was not removed — you may not have permission for it.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  revalidatePath("/accounting/payouts");
  return ok("Split removed.");
}

// ─── Receiving reopens a submitted batch to add / correct a line ─────────────
export async function reopenReceiving(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["receiving", "manager", "owner"].includes(me.role)) return fail("Not allowed to reopen receiving.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing visit.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_receiving", { p_visit_id: visitId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/receiving");
  revalidatePath("/qc");
  return ok("Reopened — add or correct lines, then submit to QC again.");
}

// ─── Utility charges (Phase 11 B) ────────────────────────────────────────────

export async function addUtilityCharge(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["processing", "manager", "owner"].includes(me.role)) return fail("Not allowed to add a charge.");

  const visitId = String(formData.get("visit_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const amount = Number(formData.get("amount"));
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!visitId) return fail("Missing visit.");
  if (!["light_bill", "other"].includes(kind)) return fail("Pick a charge type.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  // For an "other" deduction the description is its type — require it.
  if (kind === "other" && !description) return fail("Describe what the deduction is for.");

  const supabase = await createClient();
  const res = await supabase.from("utility_charges").insert({
    visit_id: visitId, kind, description, amount, recorded_by: me.id,
  }).select("id");
  const result = fromWrite(res, "The charge was not added — the batch may be closed to you.");
  if (!result.ok) return result;
  revalidatePath(`/visits/${visitId}`);
  return ok("Charge added.");
}

// Manager (or owner) discounts/adjusts a supplier's processing fee on an open
// visit by setting a new (lower) amount. The DB policy enforces role + site +
// open; all downstream totals already sum this amount.
export async function adjustUtilityCharge(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not allowed to adjust a charge.");

  const visitId = String(formData.get("visit_id") ?? "");
  const chargeId = String(formData.get("charge_id") ?? "");
  const amount = Number(formData.get("amount"));
  if (!chargeId) return fail("Missing charge.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");

  const supabase = await createClient();
  const res = await supabase.from("utility_charges").update({ amount }).eq("id", chargeId).select("id");
  const result = fromWrite(res, "The charge was not adjusted — the batch may no longer be open to you.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok("Charge adjusted.");
}

// Manager/owner sends the processing fee back to the processing employee for
// correction (reopen in place — the visit stays where it is).
export async function reopenProcessingFee(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not allowed to reopen the processing fee.");
  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return fail("Missing visit.");
  const supabase = await createClient();
  // An RPC reports refusal by raising, so the error is the whole story here —
  // fromWrite is for table writes that answer with rows.
  const { error } = await supabase.rpc("reopen_processing_fee", { p_visit_id: visitId });
  if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/processing");
  return ok("Sent back to processing for correction.");
}

// ─── Advance deductions (Phase 11 A) ─────────────────────────────────────────

export async function recordDeduction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "accounting", "owner"].includes(me.role)) return fail("Not allowed to record a deduction.");

  const visitId = String(formData.get("visit_id") ?? "") || null;
  const supplierId = String(formData.get("supplier_id") ?? "");
  const amount = Number(formData.get("amount"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  // Which balance this recovery settles: advance debt or processing (light bill).
  const kind = String(formData.get("kind") ?? "advance");
  if (!supplierId) return fail("Missing supplier.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  if (!["advance", "processing"].includes(kind)) return fail("Unknown deduction type.");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId && me.role !== "owner") return fail("Your account has no site.");

  // Owner has no site of their own — attach to the visit's site when present.
  let effectiveSite = siteId;
  if (!effectiveSite && visitId) {
    const { data: v } = await supabase.from("visits").select("site_id").eq("id", visitId).single();
    effectiveSite = (v?.site_id as string | null) ?? null;
  }
  if (!effectiveSite) return fail("Could not tell which site this deduction belongs to.");

  const res = await supabase.from("advance_deductions").insert({
    supplier_id: supplierId,
    site_id: effectiveSite,
    ref_visit_id: visitId,
    amount,
    notes,
    kind,
    recorded_by: me.id,
  }).select("id");
  const result = fromWrite(res, "The deduction was not recorded — you may not have permission for this supplier.");
  if (!result.ok) return result;
  revalidateSupplierFinance();
  return ok("Deduction recorded.");
}

// Manager/accounting/owner removes an advance deduction applied by mistake. The
// supplier's outstanding debt is recomputed automatically. Blocked once the
// batch is paid (locked).
export async function removeDeduction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "accounting", "owner"].includes(me.role)) return fail("Not allowed to remove a deduction.");
  const visitId = String(formData.get("visit_id") ?? "") || null;
  const deductionId = String(formData.get("deduction_id") ?? "");
  if (!deductionId) return fail("Missing deduction.");

  const supabase = await createClient();
  if (visitId) {
    const { data: st } = await supabase.from("batch_settlements").select("status").eq("visit_id", visitId).maybeSingle();
    if (st?.status === "paid") return fail("This batch has been paid — the deduction is locked.");
  }
  const res = await supabase.from("advance_deductions").delete().eq("id", deductionId).select("id");
  const result = fromWrite(res, "The deduction was not removed — you may not have permission for it.");
  if (!result.ok) return result;
  revalidateSupplierFinance();
  return ok("Deduction removed.");
}

// Manager/owner removes a utility deduction (processing fee / other charge)
// applied by mistake, while the visit is still open.
export async function removeUtilityCharge(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not allowed to remove a charge.");
  const visitId = String(formData.get("visit_id") ?? "") || null;
  const chargeId = String(formData.get("charge_id") ?? "");
  if (!chargeId) return fail("Missing charge.");

  const supabase = await createClient();
  const res = await supabase.from("utility_charges").delete().eq("id", chargeId).select("id");
  const result = fromWrite(res, "The charge was not removed — the batch may no longer be open to you.");
  if (!result.ok) return result;
  if (visitId) revalidatePath(`/visits/${visitId}`);
  return ok("Charge removed.");
}
