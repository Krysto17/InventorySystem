"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";

const BASES = ["weight", "bag", "hour"] as const;

// Machines are unique per (site, name), so re-adding one silently did nothing.
//
// NO .select() HERE, DELIBERATELY — do not "standardise" this to the
// .select() + fromWrite pattern used by the UPDATE/DELETE actions.
// `machines: read own site` is `site_id = current_site() OR is_owner()`, with no
// general-manager clause, while `machines: gm inserts` lets the GM insert for
// ANY site — and the form's site selector offers all of them. So the GM
// creating a machine for another site works today, but a select-back would make
// the whole INSERT ... RETURNING abort with 42501 and the row would never
// persist. Verified both ways. An INSERT refused by RLS raises anyway, so
// checking `error` loses nothing.
export async function createMachine(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return fail("Not authorized.");
  const site_id = String(formData.get("site_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const charge_basis = String(formData.get("charge_basis") ?? "");
  const rate = Number(formData.get("rate"));
  if (!site_id) return fail("Pick the site this machine belongs to.");
  if (!name) return fail("Enter a machine name.");
  // The form still offers "minute", which this list has never accepted. That
  // mismatch is a separate business decision; all that changes here is that the
  // refusal is now stated instead of swallowed.
  if (!BASES.includes(charge_basis as (typeof BASES)[number])) {
    return fail("Charge basis must be weight, bag or hour.");
  }
  if (!(rate >= 0)) return fail("Enter a rate of zero or more.");
  const supabase = await createClient();
  const { error } = await supabase.from("machines").insert({ site_id, name, charge_basis, rate, created_by: me.id });
  if (error) {
    if (error.code === "23505") return fail(`A machine named "${name}" already exists on that site.`);
    return fail(error.message.replace(/^.*?:\s*/, ""));
  }
  revalidatePath("/owner/machines");
  return ok(`${name} added.`);
}

export async function updateMachine(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return;
  const id = String(formData.get("id") ?? "");
  const patch: Record<string, unknown> = {};
  const rate = formData.get("rate");
  if (rate != null && String(rate).trim() !== "") patch.rate = Number(rate);
  const activeRaw = formData.get("active");
  if (activeRaw != null) patch.active = activeRaw === "true";
  const supabase = await createClient();
  await supabase.from("machines").update(patch as never).eq("id", id);
  revalidatePath("/owner/machines");
}
