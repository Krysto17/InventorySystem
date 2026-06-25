import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/db/relation";
import type { Role } from "@/lib/auth/roles";

export type Profile = {
  id: string;
  full_name: string;
  username: string;
  role: Role;
  site_id: string | null;
  site_name: string | null;
  must_change_password: boolean;
  status: "active" | "disabled";
  // The General Manager = a manager whose site is New-Site (the main site). They
  // get cross-site oversight + gate passes / cost-price / reports; other (site)
  // managers are scoped to their own site.
  is_general_manager: boolean;
};

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, site_id, must_change_password, status, site:sites(name)")
    .eq("id", user.id)
    .single();
  if (!data) return null;

  const site_name = one<{ name: string }>((data as { site: unknown }).site)?.name ?? null;
  return {
    id: data.id as string,
    full_name: data.full_name as string,
    username: data.username as string,
    role: data.role as Role,
    site_id: data.site_id as string | null,
    site_name,
    must_change_password: data.must_change_password as boolean,
    status: data.status as "active" | "disabled",
    is_general_manager: data.role === "manager" && site_name === "New-Site",
  };
}
