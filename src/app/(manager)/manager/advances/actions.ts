"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { accountTrioFromForm } from "@/lib/validation/account";

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
  revalidatePath("/manager/advances");
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
  revalidatePath("/manager/advances");
  return ok();
}

// Manager (own site) deletes an advance before it is paid; owner may delete any.
// RLS enforces the manager can only delete their own site's unpaid advances.
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
