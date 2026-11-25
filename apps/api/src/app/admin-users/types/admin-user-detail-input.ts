import type { AdminUserListRow } from "../../auth/types/admin-user-list-row";
import type { AdminUserProfile } from "./admin-user-profile";
import type { LedgerEntryView } from "./ledger-entry-view";

/** What the back-office user detail is built from (RNX-357): the list row, the profile and the ledger (null: not permitted). */
export type AdminUserDetailInput = {
  readonly row: AdminUserListRow;
  readonly profile: AdminUserProfile;
  readonly ledger: readonly LedgerEntryView[] | null;
};
