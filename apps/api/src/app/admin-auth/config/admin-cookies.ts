/**
 * The back-office cookies (D54): names of their own, never the product's `jwt` or better-auth cookies.
 * The access cookie goes to every path; the refresh cookie only to the refresh route
 * (global prefix `/api`, version `v1`).
 */
export const ADMIN_COOKIES = {
  access: "rx_admin_access",
  refresh: "rx_admin_refresh",
  refreshPath: "/api/v1/admin/auth/refresh",
} as const;
