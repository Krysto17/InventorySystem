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

  // Normalize username → synthetic email. Invalid chars (e.g. dots, hyphens,
  // unicode) throw from normalizeUsername; treat that as a generic credential
  // failure rather than crashing the request with a 500.
  let email: string;
  try {
    email = usernameToEmail(username, domain);
  } catch {
    return { error: "Invalid username or password" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "Invalid username or password" };

  const profile = await getProfile();
  if (!profile) return { error: "No profile found for this account" };
  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return { error: "This account has been disabled. Contact the owner." };
  }
  if (profile.must_change_password) redirect("/set-password");
  redirect(ROLE_HOME[profile.role]);
}
