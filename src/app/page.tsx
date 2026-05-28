import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME } from "@/lib/auth/roles";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.must_change_password) redirect("/set-password");
  redirect(ROLE_HOME[profile.role]);
}
