/** The body of `POST /admin/reconciliation/entries`: a provider's portal balance and top-up of one day, USD decimal strings. */
export type ReconciliationEntryInput = {
  readonly providerId: string;
  readonly day: string;
  readonly portalBalanceUsd: string;
  /** Left out, the API stores "0". */
  readonly topUpUsd?: string;
};
