/** Credits sold on one day for one package or top-up pack version (RNX-228): the snapshots' list value, not cash. */
export type CreditSalesView = {
  readonly day: string;
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
  readonly entries: number;
  readonly creditsSold: string;
  readonly listValueIdr: string;
  readonly listValueUsd: string;
};
