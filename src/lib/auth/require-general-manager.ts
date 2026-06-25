import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/get-profile";

// Gate a manager-area page to the General (New-Site) manager + owner only.
// Site managers (Old-Site / Dong) are bounced back to their pricing queue.
// Used for gate passes, cost-price, and reports (#13).
export async function requireGeneralManager() {
  const me = await getProfile();
  if (!me || !(me.is_general_manager || me.role === "owner")) {
    redirect("/manager");
  }
  return me;
}
