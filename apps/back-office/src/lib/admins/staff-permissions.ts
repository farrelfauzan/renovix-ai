/**
 * Every staff permission a role can hold: a copy of STAFF_PERMISSIONS in apps/api (the apps share no code;
 * `GET /admin/roles` lists only the permissions some role holds, so it cannot be the source of the full list).
 * The API stays the authority: it refuses an unknown permission.
 */
export const STAFF_PERMISSIONS: readonly string[] = [
  "users:read", "users:read_pii", "users:write",
  "companies:read", "companies:write",
  "enterprise_requests:read", "enterprise_requests:write",
  "guardrails:read", "guardrails:read_content", "guardrails:write",
  "models:read", "models:write",
  "providers:read", "providers:write",
  "packages:read", "packages:write",
  "credits:read", "credits:adjust",
  "usage:read", "exports:create", "support_notes:write",
  "admins:read", "admins:write",
  "roles:read", "roles:write",
  "settings:read", "settings:write",
  "audit:read",
  "profit:read", "reconciliation:write",
];

/** Held by the Owner role only: the API refuses them on a custom role, so the role form does not offer them. */
export const OWNER_ONLY_PERMISSIONS: readonly string[] = ["admins:write", "roles:write"];
