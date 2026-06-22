"use server";

import { getProfile } from "@/lib/auth/get-profile";
import { roleNotifications, type NotificationItem } from "@/lib/notifications";

// Re-fetch the signed-in user's "awaiting your action" items. Called by the
// client shell when a realtime change lands, so the bell updates without a
// reload. RLS-scoped (runs as the viewer), like the initial server render.
export async function fetchMyNotifications(): Promise<NotificationItem[]> {
  const me = await getProfile();
  if (!me) return [];
  return roleNotifications(me.role);
}
