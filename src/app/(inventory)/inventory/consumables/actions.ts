"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { accountTrioFromForm } from "@/lib/validation/account";
import { CONSUMABLE_CATEGORIES, type ConsumableCategory } from "./categories";

export async function createConsumable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["inventory", "manager", "owner"].includes(me.role)) return fail("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "") as ConsumableCategory;
  const entryDate = String(formData.get("entry_date") ?? "").trim() || null;
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const amountRaw = String(formData.get("amount_naira") ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);
  if (!name) return fail("Enter a name.");
  if (!CONSUMABLE_CATEGORIES.includes(category)) return fail("Pick a category.");
  const acct = accountTrioFromForm(formData);
  if (!acct.ok) return fail(acct.error);

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("site_id").eq("id", me.id).single();
  const siteId = profile?.site_id as string | null;
  if (!siteId) return fail("No site on your profile.");

  const res = await supabase.from("consumables").insert({
    site_id: siteId, name, category, entry_date: entryDate ?? undefined, comment,
    amount_naira: amount, ...acct.value, recorded_by: me.id,
  }).select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  revalidatePath("/inventory/consumables");
  return ok();
}

// Manager (own site) / owner edits an expense before it is paid. RLS scopes the
// site; the DB locks a paid expense and re-checks the account trio.
export async function editConsumable(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !["manager", "owner"].includes(me.role)) return fail("Not authorized.");
  const id = String(formData.get("consumable_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "") as ConsumableCategory;
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const amountRaw = String(formData.get("amount_naira") ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);
  if (!id) return fail("Missing expense.");
  if (!name) return fail("Enter a name.");
  if (!CONSUMABLE_CATEGORIES.includes(category)) return fail("Pick a category.");
  const acct = accountTrioFromForm(formData);
  if (!acct.ok) return fail(acct.error);

  const supabase = await createClient();
  const res = await supabase.from("consumables")
    .update({ name, category, comment, amount_naira: amount, ...acct.value })
    .eq("id", id).neq("approval_status", "paid").select("id");
  if (res.error) return fail(res.error.message.replace(/^.*?:\s*/, ""));
  if (!res.data || res.data.length === 0) return fail("Couldn't edit this expense — it may be paid or on another site.");
  revalidatePath("/inventory/consumables");
  return ok();
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
