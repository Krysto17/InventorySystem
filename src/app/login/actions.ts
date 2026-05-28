"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/provisioning/username";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

export async function signIn(_prev: unknown, formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username, domain),
    password,
  });
  if (error) return { error: "Invalid username or password" };

  const profile = await getProfile();
  if (!profile) return { error: "No profile found for this account" };
  if (profile.must_change_password) redirect("/set-password");
  redirect(ROLE_HOME[profile.role]);
}
