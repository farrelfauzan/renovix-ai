import type { AdminUserDetail } from "../types/admin-user-detail";
import type { AdminUserDetailInput } from "../types/admin-user-detail-input";
import { maskUserField } from "./mask-user-field";
import { toAdminUserListItem } from "./to-admin-user-list-item";

/**
 * The back-office user detail (RNX-357): the list item, the phone masked, the profile fields, the distinct sign-in
 * methods (sorted) and the ledger as given (null when the admin may not see it).
 */
export function toAdminUserDetail({ row, profile, ledger }: AdminUserDetailInput): AdminUserDetail {
  return {
    ...toAdminUserListItem(row),
    phone: maskUserField(profile.phone),
    joinedAt: profile.createdAt,
    timezone: profile.timezone,
    language: profile.locale,
    signInMethods: [...new Set(profile.accounts.map((account) => account.providerId))].sort(),
    ledger,
  };
}
