"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { provisionUser, setUserStatus, resetUserPassword } from "@/lib/provisioning/provision-user";
import { ROLES, type Role } from "@/lib/auth/roles";

async function getEmployeeRole(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  return (data?.role as string | null) ?? null;
}

export async function addEmployee(_prev: unknown, formData: FormData) {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return { error: "Not authorized" };

  const roleRaw = String(formData.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(roleRaw)) {
    return { error: "Invalid role" };
  }
  const role = roleRaw as Role;
  // Only the owner may create another owner account.
  if (role === "owner" && me.role !== "owner") {
    return { error: "Only the owner can create an owner account" };
  }

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

// Enable or disable an employee account. A disabled account can't sign in and is
// bounced to /login if already in a session. The owner cannot disable themselves.
export async function setEmployeeStatus(_prev: unknown, formData: FormData) {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return { error: "Not authorized" };

  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!userId) return { error: "Missing user" };
  if (status !== "active" && status !== "disabled") return { error: "Invalid status" };
  if (userId === me.id) return { error: "You cannot disable your own account" };

  // The general manager may not disable an owner account.
  if (me.role !== "owner") {
    const target = await getEmployeeRole(userId);
    if (target === "owner") return { error: "Only the owner can change an owner account" };
  }

  try {
    await setUserStatus(userId, status);
    revalidatePath("/owner/employees");
    return { ok: status === "disabled" ? "Account disabled." : "Account enabled." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update account" };
  }
}

/**
 * Hand an employee a fresh temporary password.
 *
 * Same authority as creating an account — owner, or the general manager — with
 * the same exception: the general manager may not touch an owner account. That
 * exception matters more here than it does for creating one, because resetting
 * a password IS taking over the account, so without it a general manager could
 * let themselves into the owner's.
 *
 * The temp password is returned to the owner's screen once and never stored or
 * logged. There is nowhere to look it up afterwards; if it is lost, reset again.
 */
export async function resetEmployeePassword(_prev: unknown, formData: FormData) {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) return { error: "Not authorized" };

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Missing user" };

  // Resetting your own password here would hand you a temp one and then force
  // you through /set-password; use the normal change-password flow instead.
  if (userId === me.id) return { error: "Use Set password to change your own." };

  if (me.role !== "owner") {
    const target = await getEmployeeRole(userId);
    if (target === "owner") return { error: "Only the owner can reset an owner account" };
  }

  try {
    const { tempPassword } = await resetUserPassword(userId);
    revalidatePath("/owner/employees");
    return {
      ok: `Temp password: ${tempPassword} — send via WhatsApp; they must change it on first login.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to reset the password" };
  }
}
