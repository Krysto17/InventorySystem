"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";

export type AuthorizeState = { error?: string };

export async function authorizeExit(
  _prev: AuthorizeState,
  formData: FormData,
): Promise<AuthorizeState> {
  const me = await getProfile();
  if (!me) return { error: "Not signed in" };
  if (me.role !== "owner") return { error: "Only owner can authorize" };

  const visitId = String(formData.get("visit_id") ?? "");
  if (!visitId) return { error: "Missing visit id" };
  const note = String(formData.get("note") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("gate_exit_authorizations").insert({
    visit_id: visitId,
    authorized_by: me.id,
    note,
  });
  if (error) return { error: error.message };

  revalidatePath(`/visits/${visitId}`);
  revalidatePath("/owner");
  return {};
}
