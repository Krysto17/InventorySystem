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
    await admin.auth.admin.deleteUser(userId); // roll back the orphaned auth user
    throw new Error(profErr.message);
  }

  await admin.from("setup_codes").insert({
    user_id: userId,
    username,
    role: input.role,
    site_id: input.role === "owner" ? null : input.siteId,
    created_by: createdBy,
  });

  return { userId, username, tempPassword };
}
