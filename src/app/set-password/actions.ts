"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

export async function setPassword(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error: updErr } = await supabase.auth.updateUser({ password });
  if (updErr) return { error: updErr.message };

  const { error: flagErr } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user!.id);
  if (flagErr) {
    return { error: "Password changed but session setup failed — contact the owner." };
  }

  const profile = await getProfile();
  if (!profile) return { error: "Password changed but profile lookup failed — please log out and back in." };
  redirect(ROLE_HOME[profile.role]);
}
