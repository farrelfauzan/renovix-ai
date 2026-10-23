/** A stored portal balance as `POST /admin/reconciliation/entries` answers. */
export type ReconciliationEntry = {
  readonly providerId: string;
  readonly day: string;
  readonly portalBalanceUsd: string;
  readonly topUpUsd: string;
  readonly enteredByAdminId: string;
};
