"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { Role } from "@/lib/auth/roles";
import type { NotificationItem } from "@/lib/notifications";

const BARE_PREFIXES = ["/login", "/set-password"];

type Props = {
  profile: { role: Role; fullName: string; username: string } | null;
  notificationItems: NotificationItem[];
  children: React.ReactNode;
};

export function AppShell({ profile, notificationItems, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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
        open={open}
        onClose={() => setOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <Header
          role={profile.role}
          notificationItems={notificationItems}
          onMenuClick={() => setOpen(true)}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
