"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";
import { accountTrioFromForm } from "@/lib/validation/account";
import { revalidateSupplierFinance } from "@/lib/finance/revalidate";

// Manager records an advance for a supplier (marked to that supplier). Created
// pending; the owner approves it before it counts toward the supplier's debt.
export async function recordAdvance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return fail("Not authorized.");

  const supplierId = String(formData.get("supplier_id") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const amount = Number(formData.get("amount_naira"));
  const comment = String(formData.get("comment") ?? "").trim() || null;
  if (!supplierId) return fail("Pick a supplier.");
  if (!purpose) return fail("Enter a purpose.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  const acct = accountTrioFromForm(formData);
  if (!acct.ok) return fail(acct.error);

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId) return fail("Owners record advances from the supplier profile per site.");

  const res = await supabase.from("advances").insert({
    supplier_id: supplierId, site_id: siteId, purpose, amount_naira: amount,
    comment, ...acct.value, recorded_by: me.id,
  }).select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  revalidateSupplierFinance();
  return ok();
}

// Manager (own site) / owner edits an advance before it is paid. RLS scopes the
// site; the DB locks a paid advance and re-checks the account trio.
export async function editAdvance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return fail("Not authorized.");
  const id = String(formData.get("advance_id") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim();
  const amount = Number(formData.get("amount_naira"));
  const comment = String(formData.get("comment") ?? "").trim() || null;
  if (!id) return fail("Missing advance.");
  if (!purpose) return fail("Enter a purpose.");
  if (!(amount > 0)) return fail("Amount must be greater than zero.");
  const acct = accountTrioFromForm(formData);
  if (!acct.ok) return fail(acct.error);

  const supabase = await createClient();
  const res = await supabase.from("advances")
    .update({ purpose, amount_naira: amount, comment, ...acct.value })
    .eq("id", id).neq("approval_status", "paid").select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  if (!res.data || res.data.length === 0) return fail("Couldn't edit this advance — it may be paid or on another site.");
  revalidateSupplierFinance();
  return ok();
}

// Manager (own site) deletes an advance before it is paid; owner may delete any.
// RLS enforces the manager can only delete their own site's unpaid advances.
//
// A refused delete is invisible without this: RLS filters the row out in the
// USING clause, so PostgREST answers `error: null, data: []` — verified against
// a paid advance, which stays exactly where it was. The screen then revalidates
// and re-renders the advance as if nothing had been asked of it, leaving a
// supplier debt the operator believes they withdrew.
export async function deleteAdvance(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || (me.role !== "manager" && me.role !== "owner")) return fail("Not authorized.");
  const id = String(formData.get("advance_id") ?? "");
  if (!id) return fail("Missing advance.");
  const supabase = await createClient();
  const res = await supabase.from("advances").delete().eq("id", id).select("id");
  const result = fromWrite(res, "That advance was not deleted — it may already be paid, or belong to another site.");
  if (!result.ok) return result;
  revalidateSupplierFinance();
  return ok("Advance deleted.");
}

// Owner approves / rejects an advance (so it counts toward — or is removed from
// — the supplier debt balance).
//
// The DB refuses this in two shapes worth showing: an advance already paid
// raises rather than quietly winding back, and any transition other than
// pending → approved/rejected is illegal. Since the decision is what moves the
// supplier's debt, a refusal the owner never sees means a balance they believe
// they changed.
export async function setAdvanceApproval(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || me.role !== "owner") return fail("Not authorized.");
  const id = String(formData.get("advance_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) return fail("Missing advance.");
  if (!["approved", "rejected"].includes(decision)) return fail("Choose approve or reject.");
  const supabase = await createClient();
  const res = await supabase.from("advances")
    .update({ approval_status: decision }).eq("id", id).select("id");
  const result = fromWrite(res, "That decision was not recorded — the advance may already have been ruled on.");
  if (!result.ok) return result;
  revalidateSupplierFinance();
  return ok(decision === "approved" ? "Advance approved." : "Advance rejected.");
}

// ─── Sharing one advance across several suppliers ────────────────────────────
// One customer collects on behalf of a group; each member carries their own
// share of the DEBT while the collector keeps whatever isn't apportioned.

export async function addAdvanceShare(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not authorized.");
  const advanceId = String(formData.get("advance_id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "");
  const amount = Number(formData.get("amount"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!advanceId) return fail("Missing advance.");
  if (!supplierId) return fail("Pick the supplier who owes this share.");
  if (!(amount > 0)) return fail("Share must be greater than zero.");

  const supabase = await createClient();
  const { error } = await supabase.from("advance_shares").insert({
    advance_id: advanceId, supplier_id: supplierId, amount, note, created_by: me.id,
  });
  if (error) {
    // 23505 = this supplier already has a share on the advance.
    if (error.code === "23505") return fail("That supplier already has a share on this advance.");
    return fail(error.message.replace(/^.*?:\s*/, ""));
  }
  revalidatePath("/manager/advances");
  return ok("Share added — their debt balance now carries it.");
}

// Removing a share moves that member's portion of the debt back onto the
// collector, so a refusal that is never shown leaves two suppliers' balances
// disagreeing with what the operator thinks they did. RLS scopes the delete to
// the advance's own site, and refuses by matching no rows.
export async function removeAdvanceShare(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not authorized.");
  const id = String(formData.get("share_id") ?? "");
  if (!id) return fail("Missing share.");
  const supabase = await createClient();
  const res = await supabase.from("advance_shares").delete().eq("id", id).select("id");
  const result = fromWrite(res, "That share was not removed — the advance may belong to another site.");
  if (!result.ok) return result;
  revalidatePath("/manager/advances");
  return ok("Share removed — the debt returns to the collector.");
}
