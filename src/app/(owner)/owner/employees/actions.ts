"use server";

import { getProfile } from "@/lib/auth/get-profile";
import { provisionUser } from "@/lib/provisioning/provision-user";
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
