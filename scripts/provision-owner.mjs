// Create the FIRST owner account on a Supabase database — used to bootstrap a
// fresh cloud project (the seed only runs on local `db reset`).
//
// Reads the target DB from the environment (or .env.local as a fallback), so you
// can point it at the cloud project:
//
//   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-REF.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=your-cloud-service-role-key \
//   node scripts/provision-owner.mjs owner1 "System Owner"
//
// Prints a one-time temp password; the owner is forced to change it on first
// login. Owner has no site (cross-site). Requires migrations already pushed
// (`npx supabase db push`).
import { config } from "dotenv";
config({ path: ".env.local" }); // fallback; real env vars (above) take precedence
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [, , username = "owner1", ...nameParts] = process.argv;
const fullName = nameParts.join(" ") || "System Owner";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";

if (!URL || !SERVICE) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (cloud values).");
  process.exit(1);
}
if (URL.includes("127.0.0.1") || URL.includes("localhost")) {
  console.error(`Refusing to run against a LOCAL url (${URL}). Pass the cloud https URL.`);
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const email = `${username}@${domain}`;
const password = randomBytes(9).toString("base64url").slice(0, 12);

const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
if (existing) {
  console.error(`Username "${username}" already exists. Use scripts/reset-password.mjs to reset it instead.`);
  process.exit(1);
}

const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error("createUser failed:", error.message); process.exit(1); }

const { error: pErr } = await admin.from("profiles").insert({
  id: data.user.id,
  full_name: fullName,
  username,
  role: "owner",
  site_id: null,
  must_change_password: true,
});
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id); // roll back the orphaned auth user
  console.error("profile insert failed:", pErr.message);
  process.exit(1);
}

console.log(`Owner provisioned on ${URL}`);
console.log(`  username: ${username}`);
console.log(`  temp password: ${password}`);
console.log("Log in with these; you'll be forced to set a new password.");
