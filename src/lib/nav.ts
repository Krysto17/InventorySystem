import type { Role } from "@/lib/auth/roles";

// Icon names map to lucide-react icons; resolved in the Sidebar client component.
export type NavIcon =
  | "dashboard"
  | "intake"
  | "processing"
  | "receiving"
  | "qc"
  | "pricing"
  | "drafts"
  | "reports"
  | "accounting"
  | "inventory"
  | "bulkSales"
  | "consumables"
  | "employees"
  | "machines"
  | "materials"
  | "visits"
  | "search";

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
};

// Per-role navigation. Owner sees the full cross-site set; every other role
// sees only its own lane plus the shared visit views it needs.
const NAV: Record<Role, NavItem[]> = {
  processing: [
    { label: "Queue", href: "/processing", icon: "processing" },
    { label: "New visit", href: "/processing/intake", icon: "intake" },
  ],
  receiving: [
    { label: "Queue", href: "/receiving", icon: "receiving" },
  ],
  qc: [
    { label: "XRF queue", href: "/qc", icon: "qc" },
  ],
  manager: [
    { label: "Pricing queue", href: "/manager", icon: "pricing" },
    { label: "Auditor drafts", href: "/manager/drafts", icon: "drafts" },
    { label: "Reports", href: "/manager/reports", icon: "reports" },
  ],
  accounting: [
    { label: "Settlements", href: "/accounting", icon: "accounting" },
    { label: "Reports", href: "/accounting/reports", icon: "reports" },
  ],
  inventory: [
    { label: "Stock", href: "/inventory", icon: "inventory" },
    { label: "Bulk sales", href: "/inventory/bulk-sales", icon: "bulkSales" },
    { label: "Lot sales", href: "/inventory/lot-sales", icon: "bulkSales" },
    { label: "Consumables", href: "/inventory/consumables", icon: "consumables" },
  ],
  auditor: [
    { label: "My drafts", href: "/auditor", icon: "drafts" },
  ],
  owner: [
    { label: "Dashboard", href: "/owner", icon: "dashboard" },
    { label: "All visits", href: "/owner/visits", icon: "visits" },
    { label: "Search", href: "/owner/search", icon: "search" },
    { label: "Employees", href: "/owner/employees", icon: "employees" },
    { label: "Material types", href: "/owner/material-types", icon: "materials" },
    { label: "Machines", href: "/owner/machines", icon: "machines" },
  ],
};

export function navForRole(role: Role): NavItem[] {
  return NAV[role] ?? [];
}

// The home path's first segment, used to decide which nav item is "active".
export function isActivePath(href: string, pathname: string): boolean {
  if (href === pathname) return true;
  // Treat sub-routes as active for the deepest matching prefix, but never let
  // a parent like "/inventory" swallow "/inventory/bulk-sales".
  return pathname.startsWith(href + "/");
}
