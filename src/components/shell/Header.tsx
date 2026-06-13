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

const ROLE_LABEL: Record<Role, string> = {
  processing: "PROCESSING",
  receiving: "RECEIVING",
  qc: "QUALITY CONTROL",
  manager: "MANAGER",
  accounting: "ACCOUNTANT",
  inventory: "INVENTORY",
  owner: "DIRECTOR / OWNER",
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
            className="inline-flex h-9 w-9 items-center justify-center rounded border border-[#4A5258] text-zinc-300 hover:bg-[#2C3338]"
          >
            <Bell size={16} />
          </button>
          {notifications > 0 && (
            <span className="mono absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ore px-1 text-[10px] font-semibold text-white">
              {notifications > 9 ? "9+" : notifications}
            </span>
          )}
        </div>
        <DarkModeToggle />
      </div>
    </header>
  );
}
