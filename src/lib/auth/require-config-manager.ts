import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/get-profile";

// Gate a technical-config page (material types, machines, employees) to the
// owner and the general (New-Site) manager — the technical lead. Site managers
// and everyone else are bounced home.
export async function requireConfigManager() {
  const me = await getProfile();
  if (!me || !(me.role === "owner" || me.is_general_manager)) {
    redirect(me?.role === "manager" ? "/manager" : "/login");
  }
  return me;
}
