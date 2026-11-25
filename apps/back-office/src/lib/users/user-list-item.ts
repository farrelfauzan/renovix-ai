import type { UserStatus } from "./user-status";

/**
 * A user in the list, as `GET /admin/users` answers (RNX-357, RNX-358): `email` is "***"; `name` "***" or null;
 * `creditsAvailable` the paid wallet's available credits (balance minus held) as a decimal string; `lastLoginAt` the
 * last sign-in (ISO 8601, null when never).
 */
export type UserListItem = {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly package: { readonly id: string; readonly name: string } | null;
  readonly creditsAvailable: string;
  readonly status: UserStatus;
  readonly lastLoginAt: string | null;
};
