import type { UserLedgerEntry } from "./user-ledger-entry";
import type { UserListItem } from "./user-list-item";

/**
 * A user as `GET /admin/users/:id` answers (RNX-357): the list item plus `phone` ("***" or null), the joined date,
 * timezone, language and sign-in methods. `ledger` is null when the admin's role lacks `credits:read`.
 */
export type UserDetail = UserListItem & {
  readonly phone: string | null;
  readonly joinedAt: string;
  readonly timezone: string | null;
  readonly language: string | null;
  readonly signInMethods: readonly string[];
  readonly ledger: readonly UserLedgerEntry[] | null;
};
