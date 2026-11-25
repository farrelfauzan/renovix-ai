/**
 * The back-office user list's filters and window (RNX-357). `email` and `id` match exactly; `status` is the derived
 * label ("active", "suspended" or "locked"); `packageId` is the user's package (the one the entitlement reports).
 */
export type AdminUserListQuery = {
  readonly email?: string;
  readonly id?: string;
  readonly packageId?: string;
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
};
