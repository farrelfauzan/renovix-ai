/** Names of the built-in back-office roles, seeded by the migration `20261014120000_admin_roles` (RX-96, PRD 09 F5). */
export const BUILT_IN_ROLES = {
  owner: "owner",
  operations: "operations",
  finance: "finance",
  support: "support",
  viewer: "viewer",
} as const;
