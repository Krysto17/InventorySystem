"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { createClient } from "@/lib/supabase/client";
import { fetchMyNotifications } from "@/app/notification-actions";
import type { Role } from "@/lib/auth/roles";
import type { NotificationItem } from "@/lib/notifications";

const BARE_PREFIXES = ["/login", "/set-password"];

// Tables whose changes can alter a role's "awaiting your action" counts.
const NOTIFY_TABLES = [
  "visits", "gate_passes", "bulk_sales", "lot_sales", "advances",
  "consumables", "cost_price_runs", "batch_settlements", "payments",
];

type Props = {
  profile: { role: Role; fullName: string; username: string; isGeneralManager: boolean } | null;
  notificationItems: NotificationItem[];
  children: React.ReactNode;
};

export function AppShell({ profile, notificationItems, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>(notificationItems);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in sync with the server-rendered value on navigation.
  useEffect(() => setItems(notificationItems), [notificationItems]);

  // Realtime: when a queue/approval table changes, re-fetch the viewer's counts
  // so the bell updates without a reload. Degrades silently if realtime is down.
  const role = profile?.role;
  useEffect(() => {
    if (!role) return;
    const supabase = createClient();

    const refresh = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(async () => {
        try {
          setItems(await fetchMyNotifications());
        } catch {
          /* realtime/refetch hiccup — keep the last known counts */
        }
      }, 400);
    };

    const channel = supabase.channel("role-notifications");
    for (const table of NOTIFY_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      supabase.removeChannel(channel);
    };
  }, [role]);

  const bare = !profile || BARE_PREFIXES.some((p) => pathname.startsWith(p));

  if (bare) {
    // Login / set-password / unauthenticated — render content with no chrome.
    return <main className="flex-1">{children}</main>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        role={profile.role}
        fullName={profile.fullName}
        username={profile.username}
        isGeneralManager={profile.isGeneralManager}
        open={open}
        onClose={() => setOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <Header
          role={profile.role}
          notificationItems={items}
          onMenuClick={() => setOpen(true)}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
