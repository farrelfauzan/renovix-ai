import type { UserStatus } from "./user-status";

/** The parameters of `GET /admin/users`: exact `email` or `id`, the `packageId` and `status` filters, `page` from 1. */
export type UserListQuery = {
  readonly email?: string;
  readonly id?: string;
  readonly packageId?: string;
  readonly status?: UserStatus;
  readonly page: number;
};
