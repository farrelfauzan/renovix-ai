import type { UserListItem } from "./user-list-item";

/** One page of the user list: `hasMore` is true when a next page has users (the API gives no total). */
export type UserListPage = {
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly items: readonly UserListItem[];
};
