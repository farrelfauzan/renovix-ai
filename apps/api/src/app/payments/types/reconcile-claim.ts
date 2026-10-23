/** One reconciliation run's claim (RNX-35): the provider's orders to look at, the time, until when the claim holds, and how many. */
export type ReconcileClaim = {
  readonly provider: string;
  readonly now: Date;
  readonly claimUntil: Date;
  readonly limit: number;
};
