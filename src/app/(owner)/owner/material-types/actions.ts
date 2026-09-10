"use server";

import { revalidatePath } from "next/cache";
import { revalidateReference } from "@/lib/reference";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { fail, ok, type ActionResult } from "@/lib/actions/result";

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

export async function toggleMaterialType(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return;
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  await supabase.from("material_types").update({ active }).eq("id", id);
  revalidateReference("materials");
  revalidatePath("/owner/material-types");
}
