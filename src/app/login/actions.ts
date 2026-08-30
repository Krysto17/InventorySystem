"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/provisioning/username";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

// Buckets a failed attempt counts against. Both, so guessing one password
// across many usernames is throttled by IP, and guessing many passwords for one
// username is throttled by username — neither alone catches both shapes.
async function throttleBuckets(username: string): Promise<string[]> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const buckets = [`ip:${ip}`];
  if (username) buckets.push(`user:${username.toLowerCase()}`);
  return buckets;
}

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
  const buckets = await throttleBuckets(username);

  // The throttle runs server-side only. It was briefly callable from the
  // browser, which let anyone clear their own counter (defeating it) or inflate
  // someone else's (a denial of service against a named employee). The
  // service-role client stays on the server; the functions are granted to
  // nobody else.
  const throttle = createAdminClient();

  // Wait out any backoff before the password is even checked, so a guess costs
  // time whether or not the account exists.
  const { data: waitFor } = await throttle.rpc("auth_throttle_check", { p_buckets: buckets });
  if (Number(waitFor ?? 0) > 0) {
    return { error: `Too many attempts. Try again in ${Number(waitFor)} second${Number(waitFor) === 1 ? "" : "s"}.` };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await throttle.rpc("auth_throttle_fail", { p_buckets: buckets });
    // Same message whether the username is unknown or the password is wrong.
    return { error: "Invalid username or password" };
  }
  await throttle.rpc("auth_throttle_clear", { p_buckets: buckets });

  const profile = await getProfile();
  if (!profile) return { error: "No profile found for this account" };
  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return { error: "This account has been disabled. Contact the owner." };
  }
  if (profile.must_change_password) redirect("/set-password");
  redirect(ROLE_HOME[profile.role]);
}
