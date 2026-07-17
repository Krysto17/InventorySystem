"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export async function createMaterialType(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await createClient();
  await supabase.from("material_types").insert({ name, created_by: me.id });
  revalidatePath("/owner/material-types");
}

export async function toggleMaterialType(formData: FormData): Promise<void> {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return;
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const supabase = await createClient();
  await supabase.from("material_types").update({ active }).eq("id", id);
  revalidatePath("/owner/material-types");
}
