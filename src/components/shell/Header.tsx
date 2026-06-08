"use client";

import { useRouter } from "next/navigation";
import { Menu, Bell, Search } from "lucide-react";
import { DarkModeToggle } from "./DarkModeToggle";
import type { Role } from "@/lib/auth/roles";

type Props = {
  role: Role;
  notifications: number;
  onMenuClick: () => void;
};

export function Header({ role, notifications, onMenuClick }: Props) {
  const router = useRouter();
  const isOwner = role === "owner";

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const q = String(fd.get("q") ?? "").trim();
    if (isOwner) router.push(`/owner/search${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
      <button
        type="button"
        onClick={onMenuClick}
        className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 md:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      <form onSubmit={onSearch} className="relative flex-1 max-w-md">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
        />
        <input
          name="q"
          type="text"
          disabled={!isOwner}
          placeholder={isOwner ? "Search visits, suppliers, plates…" : "Search (owner only)"}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-9 pr-12 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 sm:block">
          ⌘K
        </kbd>
      </form>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            aria-label="Notifications"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Bell size={16} />
          </button>
          {notifications > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
              {notifications > 9 ? "9+" : notifications}
            </span>
          )}
        </div>
        <DarkModeToggle />
      </div>
    </header>
  );
}
