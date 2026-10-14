/**
 * Every back-office (staff) permission, as `resource:action` (RX-96, PRD 09 F5). A `staff` route lists the
 * ones it needs in `@Access({ auth: ["staff"], permissions: [...] })`; a role is a named set of them.
 * Product permissions (RX-41, RX-111) are a separate set: no product credential reaches a staff route.
 */
export const STAFF_PERMISSIONS = [
  "users:read",
  "users:read_pii",
  "users:write",
  "companies:read",
  "companies:write",
  "enterprise_requests:read",
  "enterprise_requests:write",
  "guardrails:read",
  "guardrails:read_content",
  "guardrails:write",
  "models:read",
  "models:write",
  "providers:read",
  "providers:write",
  "packages:read",
  "packages:write",
  "credits:read",
  "credits:adjust",
  "usage:read",
  "exports:create",
  "support_notes:write",
  "admins:read",
  "admins:write",
  "roles:read",
  "roles:write",
  "settings:read",
  "settings:write",
] as const;
