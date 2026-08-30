// The blueprint's "Auditor", "Director", and "System Owner" are all the same
// person as the `owner` role — no separate logins for them.
export const ROLES = [
  "processing", "receiving", "qc", "manager", "accounting", "inventory", "stock_keeper", "gate", "owner",
] as const;

export type Role = (typeof ROLES)[number];

// Roles with any path at all to deleting a batch. The CONDITIONS — which site,
// which state, whether a settlement exists — belong to the delete_batch RPC
// (0142) and are deliberately not restated here; this list only keeps out the
// roles that have no delete path whatsoever. Keep in step with that migration.
export const DELETE_BATCH_ROLES: readonly Role[] = [
  "owner", "manager", "processing", "receiving",
];

export const ROLE_HOME: Record<Role, string> = {
  processing: "/processing",
  receiving: "/receiving",
  qc: "/qc",
  manager: "/manager",
  accounting: "/accounting",
  inventory: "/inventory",
  stock_keeper: "/stocked-materials",
  gate: "/gate",
  owner: "/owner",
};
