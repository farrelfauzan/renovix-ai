/**
 * A user in the back-office list (RNX-357). `email` is always "***"; `name` is "***", or null when the user has none.
 * `package` is the user's package (null without one); `creditsBalance` the paid wallet's balance ("0" without one);
 * `status` "active", "suspended" or "locked"; `lastLoginAt` the last sign-in (null when never).
 */
export type AdminUserListItem = {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly package: { readonly id: string; readonly name: string } | null;
  readonly creditsBalance: string;
  readonly status: string;
  readonly lastLoginAt: Date | null;
};
