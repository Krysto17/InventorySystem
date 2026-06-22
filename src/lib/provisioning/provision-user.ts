import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeUsername, usernameToEmail } from "@/lib/provisioning/username";
import type { Role } from "@/lib/auth/roles";

export type ProvisionInput = {
  fullName: string;
  username: string;
  role: Role;
  siteId: string | null;
};

function generateTempPassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

export async function provisionUser(input: ProvisionInput, createdBy: string) {
  const username = normalizeUsername(input.username);
  const domain = process.env.SYNTHETIC_EMAIL_DOMAIN ?? "magneticjoezion.local";
  const tempPassword = generateTempPassword();
  const admin = createAdminClient();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username, domain),
    password: tempPassword,
    email_confirm: true,
  });
  if (authErr || !created.user) throw new Error(authErr?.message ?? "Auth create failed");
  const userId = created.user.id;

  const { error: profErr } = await admin.from("profiles").insert({
    id: userId,
    full_name: input.fullName,
    username,
    role: input.role,
    site_id: input.role === "owner" ? null : input.siteId,
    must_change_password: true,
    created_by: createdBy,
  });
  if (profErr) {
    const { error: rollbackErr } = await admin.auth.admin.deleteUser(userId);
    if (rollbackErr) {
      console.error("provisionUser: rollback failed; auth user orphaned", {
        userId,
        profileError: profErr.message,
        rollbackError: rollbackErr.message,
      });
    }
    throw new Error(profErr.message);
  }

  const { error: codeErr } = await admin.from("setup_codes").insert({
    user_id: userId,
    username,
    role: input.role,
    site_id: input.role === "owner" ? null : input.siteId,
    created_by: createdBy,
  });
  if (codeErr) {
    console.error("provisionUser: failed to insert setup_codes audit row", {
      userId,
      username,
      error: codeErr.message,
    });
    // Do NOT roll back; the user account is valid. The audit row can be backfilled.
  }

  return { userId, username, tempPassword };
}

// Passwords are bcrypt-hashed in Supabase Auth and cannot be read back — a
// forgotten password is RESET, not retrieved. The owner generates a new one-time
// temp password (handed over WhatsApp); the user is forced to change it on next
// login (must_change_password = true).
export async function resetUserPassword(userId: string) {
  const admin = createAdminClient();
  const tempPassword = generateTempPassword();

  const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (authErr) throw new Error(authErr.message);

  const { error: profErr } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);
  if (profErr) throw new Error(profErr.message);

  return { tempPassword };
}
