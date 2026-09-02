import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/get-profile";
import { ROLE_HOME, type Role } from "@/lib/auth/roles";

// Who runs the cost-price / mixing-batch module: the owner, the General
// (New-Site) manager, and the INVENTORY employee — stock is their lane, and a
// mixing batch is made of stock lots. Site managers are not in it (#13).
// The DB says the same thing (0149); this only keeps the page out of reach.
export function canUseCostPrice(
  me: { role: Role; is_general_manager: boolean } | null,
): boolean {
  return !!me && (me.role === "owner" || me.role === "inventory" || me.is_general_manager);
}

export async function requireCostPriceUser() {
  const me = await getProfile();
  if (!canUseCostPrice(me)) redirect(me ? ROLE_HOME[me.role] : "/login");
  return me!;
}
