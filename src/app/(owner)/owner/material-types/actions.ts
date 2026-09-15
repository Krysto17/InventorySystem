"use server";

import { revalidatePath } from "next/cache";
import { revalidateReference } from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, fromWrite, ok, type ActionResult } from "@/lib/actions/result";

// material_types.name is globally UNIQUE, so "add the material that already
// exists" is the everyday mistake — and it used to do nothing at all: the insert
// raised 23505, the error was dropped, the page revalidated, and the operator
// was left retyping a name that could never be added.
//
// An INSERT refused by RLS RAISES rather than matching zero rows, so checking
// `error` catches both that and the duplicate. There is deliberately no
// .select() here.
export async function createMaterialType(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return fail("Not authorized.");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return fail("Enter a material name.");
  const supabase = await createClient();
  const { error } = await supabase.from("material_types").insert({ name, created_by: me.id });
  if (error) {
    if (error.code === "23505") return fail(`A material type named "${name}" already exists.`);
    return fail(error.message.replace(/^.*?:\s*/, ""));
  }
  revalidateReference("materials");
  revalidatePath("/owner/material-types");
  return ok(`${name} added.`);
}

// Enable/disable a material type. material_types is readable by everyone, so a
// select-back is safe; the reachable refusal is a row deleted from under the
// list, which matched nothing and said nothing.
export async function toggleMaterialType(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return fail("Not authorized.");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return fail("Missing material type.");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  const res = await supabase.from("material_types")
    .update({ active }).eq("id", id).select("id");
  const result = fromWrite(res, "That material type was not updated — it may no longer exist.");
  if (!result.ok) return result;
  revalidateReference("materials");
  revalidatePath("/owner/material-types");
  return ok(active ? "Material enabled." : "Material disabled.");
}
