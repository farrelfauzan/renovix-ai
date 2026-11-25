import type { AdminUserListItem } from "./admin-user-list-item";

/** One page of the back-office user list (RNX-357): `hasMore` is true when a next page has users. */
export type AdminUserPage = {
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly items: readonly AdminUserListItem[];
};
