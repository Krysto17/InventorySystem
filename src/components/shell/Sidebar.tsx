"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, PackagePlus, Factory, FlaskConical, Tags, Wallet,
  Boxes, ShoppingCart, Droplets, Users, Settings2, Layers, ScrollText,
  Search, LogOut, X, Microscope,
} from "lucide-react";
import { navForRole, isActivePath, type NavIcon } from "@/lib/nav";
import type { Role } from "@/lib/auth/roles";
import { logout } from "@/app/auth-actions";

const ICONS: Record<NavIcon, React.ComponentType<{ size?: number }>> = {
  dashboard: LayoutDashboard,
  intake: PackagePlus,
  processing: Factory,
  receiving: FlaskConical,
  qc: Microscope,
  pricing: Tags,
  accounting: Wallet,
  inventory: Boxes,
  bulkSales: ShoppingCart,
  consumables: Droplets,
  employees: Users,
  machines: Settings2,
  materials: Layers,
  visits: ScrollText,
  search: Search,
};

const ROLE_LABEL: Record<Role, string> = {
  processing: "Processing",
  receiving: "Receiving",
  qc: "Quality Control",
  manager: "Manager",
  accounting: "Accounting",
  inventory: "Inventory",
  owner: "Owner",
};

type Props = {
  role: Role;
  fullName: string;
  username: string;
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ role, fullName, username, open, onClose }: Props) {
  const pathname = usePathname();
  const items = navForRole(role);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-zinc-200 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-900 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-4 py-4">
          <Link href={`/${role}`.replace("/owner", "/owner")} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              MJ
            </span>
            <span className="text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
              Magnetic Joezion
              <span className="block text-[10px] font-normal text-zinc-500">Inventory System</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 md:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActivePath(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/15 dark:text-brand-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <Icon size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="mb-2 px-1">
            <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{fullName}</div>
            <div className="truncate text-xs text-zinc-500">
              {username} · {ROLE_LABEL[role]}
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
