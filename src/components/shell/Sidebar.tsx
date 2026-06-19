"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, PackagePlus, Factory, FlaskConical, Tags, Wallet,
  Boxes, ShoppingCart, Droplets, Users, Settings2, Layers, ScrollText,
  Search, LogOut, X, Microscope, BarChart3, ShieldCheck,
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
  reports: BarChart3,
  security: ShieldCheck,
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
  security: "Security",
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
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r-[1.5px] border-line bg-[#F4F5F4] transition-transform dark:bg-[#1B1F23] md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b-[1.5px] border-line px-4 py-3.5">
          <Link href={`/${role}`.replace("/owner", "/owner")} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-ore text-sm font-bold text-white">
              MJ
            </span>
            <span className="text-sm font-extrabold leading-tight tracking-tight text-ink">
              Magnetic Joezion
              <span className="mono block text-[9px] font-normal tracking-[0.08em] text-ink-2">INVENTORY · LEDGER</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-2 hover:text-ink md:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3">
          <div className="px-5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9AA3A1]">
            Modules
          </div>
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActivePath(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 border-l-[3px] px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                  active
                    ? "border-ore bg-panel text-ore"
                    : "border-transparent text-ink-2 hover:text-ink"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        <div className="border-t-[1.5px] border-line p-3">
          <div className="mb-2 px-1">
            <div className="truncate text-sm font-semibold text-ink">{fullName}</div>
            <div className="mono truncate text-[11px] text-ink-2">
              {username} · {ROLE_LABEL[role]}
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-panel hover:text-ink"
            >
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
