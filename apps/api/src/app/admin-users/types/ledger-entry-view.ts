/** A credit ledger entry in the back-office user detail (RNX-357); amounts are signed decimal strings. */
export type LedgerEntryView = {
  readonly id: string;
  readonly wallet: string;
  readonly type: string;
  readonly amount: string;
  readonly balanceAfter: string;
  readonly createdAt: Date;
};
