import type { AdminUserListItem } from "./admin-user-list-item";
import type { LedgerEntryView } from "./ledger-entry-view";

/**
 * A user in the back-office detail (RNX-357): the list item, plus `phone` ("***", or null when not set), the joined
 * date, timezone, language and sign-in methods (account providers: "credential", "google", ...). `ledger` is the last
 * 20 ledger entries when the admin holds `credits:read`, and null when not (an empty list means no entries).
 */
export type AdminUserDetail = AdminUserListItem & {
  readonly phone: string | null;
  readonly joinedAt: Date;
  readonly timezone: string | null;
  readonly language: string | null;
  readonly signInMethods: readonly string[];
  readonly ledger: readonly LedgerEntryView[] | null;
};
