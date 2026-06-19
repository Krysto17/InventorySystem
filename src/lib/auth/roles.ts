// The blueprint's "Auditor", "Director", and "System Owner" are all the same
// person as the `owner` role — no separate logins for them.
export const ROLES = [
  "processing", "receiving", "qc", "manager", "accounting", "inventory", "security", "owner",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  processing: "/processing",
  receiving: "/receiving",
  qc: "/qc",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  security: "/security",
  owner: "/owner",
};
