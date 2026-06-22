"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth/get-profile";
import { provisionUser, resetUserPassword } from "@/lib/provisioning/provision-user";
import { ROLES, type Role } from "@/lib/auth/roles";

export async function addEmployee(_prev: unknown, formData: FormData) {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Not authorized" };

  const roleRaw = String(formData.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(roleRaw)) {
    return { error: "Invalid role" };
  }
  const role = roleRaw as Role;

  const siteId = formData.get("siteId") ? String(formData.get("siteId")) : null;
  try {
    const result = await provisionUser(
      {
        fullName: String(formData.get("fullName")),
        username: String(formData.get("username")),
        role,
        siteId,
      },
      me.id,
    );
    return {
      ok: `Created ${result.username}. Temp password: ${result.tempPassword} ` +
        `— send via WhatsApp; they must change it on first login.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create employee" };
  }
}

// Reset a forgotten password: the owner generates a fresh one-time temp password
// (shown once, to be handed over WhatsApp). Passwords can never be read back.
export async function resetEmployeePassword(_prev: unknown, formData: FormData) {
  const me = await getProfile();
  if (!me || me.role !== "owner") return { error: "Not authorized" };

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Missing user" };

  try {
    const { tempPassword } = await resetUserPassword(userId);
    revalidatePath("/owner/employees");
    return {
      ok: `New temp password: ${tempPassword} — send via WhatsApp; they must change it on next login.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to reset password" };
  }
}
