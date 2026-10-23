/** Credits sold on a day for one package or top-up pack version, at the snapshots' list prices. */
export type CreditSalesView = {
  readonly day: string;
  readonly packageVersionId: string | null;
  readonly topUpPackVersionId: string | null;
  readonly entries: number;
  readonly creditsSold: string;
  readonly listValueIdr: string;
  readonly listValueUsd: string;
};
