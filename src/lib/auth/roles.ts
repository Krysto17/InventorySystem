export const ROLES = [
  "processing", "receiving", "qc", "manager", "accounting", "inventory", "owner",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  processing: "/processing",
  receiving: "/receiving",
  qc: "/qc",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  owner: "/owner",
};
