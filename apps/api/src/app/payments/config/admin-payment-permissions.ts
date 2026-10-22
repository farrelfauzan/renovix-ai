/**
 * The staff permissions of the admin payment routes (RNX-35, decision 81 option a, D264): no payment permission of its
 * own. Reading a day and its CSV reuse `credits:read`; the two writes ("confirm from provider", "mark unmatched as
 * refunded") reuse `credits:adjust`, with a re-authentication on the routes. This is the one place the choice is made.
 */
export const ADMIN_PAYMENT_PERMISSIONS = {
  read: ["credits:read"],
  write: ["credits:adjust"],
} as const;
