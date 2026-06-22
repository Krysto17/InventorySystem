// Reset ANY account's password by username — the break-glass path for when the
// OWNER is locked out (no one can reset the owner from inside the app).
//
// Requires the Supabase service-role key (already in .env.local). Run:
//   node scripts/reset-password.mjs <username> [newPassword]
// If newPassword is omitted, a random one is generated and printed. The user is
// forced to change it on next login.
//
// Passwords are bcrypt-hashed and can never be read back — this REPLACES, it does
// not retrieve. For a hosted Supabase project you can do the same from the
// dashboard: Authentication → Users → (user) → Reset/again set password.
import { config } from "dotenv";
config({ path: ".env.local" });
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [, , username, explicitPw] = process.argv;
if (!username) {
  console.error("usage: node scripts/reset-password.mjs <username> [newPassword]");
  process.exit(1);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const password = explicitPw || randomBytes(9).toString("base64url").slice(0, 12);

const { data: profile, error: pErr } = await admin
  .from("profiles").select("id, role").eq("username", username).maybeSingle();
if (pErr) { console.error(pErr.message); process.exit(1); }
if (!profile) { console.error(`No account with username "${username}"`); process.exit(1); }

const { error: authErr } = await admin.auth.admin.updateUserById(profile.id, { password });
if (authErr) { console.error(authErr.message); process.exit(1); }
await admin.from("profiles").update({ must_change_password: true }).eq("id", profile.id);

console.log(`Reset ${username} (${profile.role}).`);
console.log(`Temp password: ${password}`);
console.log("They must change it on next login.");
