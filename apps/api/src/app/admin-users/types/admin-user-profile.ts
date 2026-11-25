/** The detail fields of a user that the list row does not hold (RNX-357), as read from the database. */
export type AdminUserProfile = {
  readonly phone: string | null;
  readonly timezone: string | null;
  readonly locale: string | null;
  readonly createdAt: Date;
  readonly accounts: readonly { readonly providerId: string }[];
};
