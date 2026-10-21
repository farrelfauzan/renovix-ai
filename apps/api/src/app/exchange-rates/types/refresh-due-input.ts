/** When the latest stored rate was fetched, and the moment to judge it at (RNX-53). */
export type RefreshDueInput = {
  readonly fetchedAt: Date;
  readonly now: Date;
};
