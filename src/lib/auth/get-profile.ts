import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/auth/roles";

export type Profile = {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  site_id: string | null;
  must_change_password: boolean;
  status: "active" | "disabled";
};

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, site_id, must_change_password, status")
    .eq("id", user.id)
    .single();
  return (data as Profile) ?? null;
}
