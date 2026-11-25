import { PERSONAL_DATA_MASK } from "../../admin-auth/config/personal-data-mask";
import type { AdminUserListRow } from "../../auth/types/admin-user-list-row";
import type { AdminUserListItem } from "../types/admin-user-list-item";
import { maskUserField } from "./mask-user-field";

/** A list row as the back office shows it (RNX-357): email masked (every user has one; it is not read), name masked, the package as `{ id, name }` or null. */
export function toAdminUserListItem(row: AdminUserListRow): AdminUserListItem {
  return {
    id: row.id,
    email: PERSONAL_DATA_MASK,
    name: maskUserField(row.name),
    package: row.packageId === null || row.packageName === null ? null : { id: row.packageId, name: row.packageName },
    creditsAvailable: row.creditsAvailable.toString(),
    status: row.status,
    lastLoginAt: row.lastLoginAt,
  };
}
