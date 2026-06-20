"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Bell, Search } from "lucide-react";
import { DarkModeToggle } from "./DarkModeToggle";
import type { Role } from "@/lib/auth/roles";
import type { NotificationItem } from "@/lib/notifications";

type Props = {
  role: Role;
  notificationItems: NotificationItem[];
  onMenuClick: () => void;
};

const ROLE_LABEL: Record<Role, string> = {
  processing: "PROCESSING",
  receiving: "RECEIVING",
  qc: "QUALITY CONTROL",
  manager: "MANAGER",
  accounting: "ACCOUNTANT",
  inventory: "INVENTORY",
  gate: "GATE",
  owner: "DIRECTOR / OWNER",
};

export function Header({ role, notificationItems, onMenuClick }: Props) {
  const router = useRouter();
  const isOwner = role === "owner";
  const [bellOpen, setBellOpen] = useState(false);
  const notifications = notificationItems.reduce((s, n) => s + n.count, 0);

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const q = String(fd.get("q") ?? "").trim();
    if (isOwner) router.push(`/owner/search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-13 items-center gap-3 bg-[#1B1F23] px-4 py-2.5 text-white">
      <button
        type="button"
        onClick={onMenuClick}
        className="text-zinc-300 hover:text-white md:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <span className="hidden text-[15px] font-extrabold tracking-tight md:block">
        Magnetic<span className="text-[#F3C892]">Joezion</span>
      </span>

      <form onSubmit={onSearch} className="relative ml-2 flex-1 max-w-md">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          name="q"
          type="text"
          disabled={!isOwner}
          placeholder={isOwner ? "Search visits, suppliers, plates…" : "Search (owner only)"}
          className="mono w-full rounded border border-[#4A5258] bg-[#2C3338] py-1.5 pl-9 pr-3 text-[12px] text-white placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ore disabled:opacity-50"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        <span className="mono hidden text-[11px] tracking-[0.05em] text-zinc-400 sm:block">
          {ROLE_LABEL[role]}
        </span>
        <div className="relative">
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setBellOpen((o) => !o)}
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#4A5258] text-zinc-300 hover:bg-[#2C3338]"
          >
            <Bell size={16} />
          </button>
          {notifications > 0 && (
            <span className="mono absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ore px-1 text-[10px] font-semibold text-white">
              {notifications > 9 ? "9+" : notifications}
            </span>
          )}
          {bellOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-lg border border-line bg-paper text-ink shadow-lg dark:bg-zinc-900">
                <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink-2">
                  Awaiting your action
                </div>
                {notificationItems.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-ink-2">You&apos;re all caught up.</p>
                ) : (
                  <ul className="max-h-80 overflow-auto">
                    {notificationItems.map((n) => (
                      <li key={n.label}>
                        <Link
                          href={n.href}
                          onClick={() => setBellOpen(false)}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span>{n.label}</span>
                          <span className="mono flex h-5 min-w-5 items-center justify-center rounded-full bg-ore px-1.5 text-[11px] font-semibold text-white">
                            {n.count}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
        <DarkModeToggle />
      </div>
    </header>
  );
}
