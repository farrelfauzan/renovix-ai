/** A stored portal balance (RNX-228): the provider record, the day, the amounts in USD and the admin who entered it. */
export type ReconciliationEntryView = {
  readonly providerId: string;
  readonly day: string;
  readonly portalBalanceUsd: string;
  readonly topUpUsd: string;
  readonly enteredByAdminId: string;
};
