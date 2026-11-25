/** A credit ledger entry in the user detail (RNX-357); amounts are signed decimal strings, `createdAt` ISO 8601. */
export type UserLedgerEntry = {
  readonly id: string;
  readonly wallet: string;
  readonly type: string;
  readonly amount: string;
  readonly balanceAfter: string;
  readonly createdAt: string;
};
