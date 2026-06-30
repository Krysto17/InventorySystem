import type { Role } from "@/lib/auth/roles";

// Icon names map to lucide-react icons; resolved in the Sidebar client component.
export type NavIcon =
  | "dashboard"
  | "intake"
  | "processing"
  | "receiving"
  | "qc"
  | "pricing"
  | "reports"
  | "gate"
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
  // Manager items visible only to the General (New-Site) manager — hidden from
  // site managers (Old-Site / Dong).
  generalOnly?: boolean;
};

// Per-role navigation. Owner sees the full cross-site set; every other role
// sees only its own lane plus the shared visit views it needs.
const NAV: Record<Role, NavItem[]> = {
  processing: [
    { label: "Queue", href: "/processing", icon: "processing" },
    { label: "New unprocessed", href: "/processing/intake", icon: "intake" },
  ],
  receiving: [
    { label: "Queue", href: "/receiving", icon: "receiving" },
    { label: "New processed", href: "/receiving/intake", icon: "intake" },
  ],
  qc: [
    { label: "XRF queue", href: "/qc", icon: "qc" },
    { label: "My analyses", href: "/qc/analyses", icon: "qc" },
    { label: "Samples", href: "/qc/samples", icon: "qc" },
  ],
  manager: [
    { label: "Pricing queue", href: "/manager", icon: "pricing" },
    { label: "Advances", href: "/manager/advances", icon: "accounting" },
    { label: "Expenses", href: "/inventory/consumables", icon: "consumables" },
    // General (New-Site) manager only — site managers can't see these (#13).
    { label: "Gate passes", href: "/manager/gate-passes", icon: "gate", generalOnly: true },
    { label: "Reports", href: "/manager/reports", icon: "reports", generalOnly: true },
    { label: "Cost price", href: "/manager/cost-price", icon: "pricing", generalOnly: true },
    { label: "Analyses", href: "/manager/analyses", icon: "qc", generalOnly: true },
  ],
  accounting: [
    { label: "Settlements", href: "/accounting", icon: "accounting" },
    { label: "To pay", href: "/accounting/payouts", icon: "accounting" },
    { label: "Reports", href: "/accounting/reports", icon: "reports" },
  ],
  inventory: [
    { label: "Stock", href: "/inventory", icon: "inventory" },
    { label: "Bulk sales", href: "/inventory/bulk-sales", icon: "bulkSales" },
    { label: "Lot sales", href: "/inventory/lot-sales", icon: "bulkSales" },
    { label: "Consumables", href: "/inventory/consumables", icon: "consumables" },
  ],
  gate: [
    { label: "Gate", href: "/gate", icon: "gate" },
  ],
  owner: [
    { label: "Dashboard", href: "/owner", icon: "dashboard" },
    { label: "Approvals", href: "/owner/approvals", icon: "pricing" },
    { label: "Analyses", href: "/owner/analyses", icon: "qc" },
    { label: "Ledger", href: "/owner/ledger", icon: "accounting" },
    { label: "Finance breakdown", href: "/owner/finance", icon: "reports" },
    { label: "Mixing batches", href: "/owner/cost-batches", icon: "bulkSales" },
    { label: "Gate oversight", href: "/owner/gate", icon: "gate" },
    { label: "All visits", href: "/owner/visits", icon: "visits" },
    { label: "Search", href: "/owner/search", icon: "search" },
    { label: "Employees", href: "/owner/employees", icon: "employees" },
    { label: "Material types", href: "/owner/material-types", icon: "materials" },
    { label: "Machines", href: "/owner/machines", icon: "machines" },
  ],
};

export function navForRole(role: Role, opts?: { isGeneralManager?: boolean }): NavItem[] {
  const items = NAV[role] ?? [];
  if (role === "manager" && !opts?.isGeneralManager) {
    return items.filter((i) => !i.generalOnly);
  }
  return items;
}

// The home path's first segment, used to decide which nav item is "active".
export function isActivePath(href: string, pathname: string): boolean {
  if (href === pathname) return true;
  // Treat sub-routes as active for the deepest matching prefix, but never let
  // a parent like "/inventory" swallow "/inventory/bulk-sales".
  return pathname.startsWith(href + "/");
}
