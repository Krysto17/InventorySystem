export const ROLES = [
  "processing", "receiving", "manager", "accounting", "inventory", "owner",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  processing: "/processing",
  receiving: "/receiving",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  owner: "/owner",
};
