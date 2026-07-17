"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/get-profile";
import { provisionUser, setUserStatus } from "@/lib/provisioning/provision-user";
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
