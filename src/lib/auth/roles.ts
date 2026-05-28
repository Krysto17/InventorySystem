export const ROLES = [
  "gate", "processing", "receiving", "manager", "accounting", "inventory", "owner",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  gate: "/gate",
  processing: "/processing",
  receiving: "/receiving",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  owner: "/owner",
};
