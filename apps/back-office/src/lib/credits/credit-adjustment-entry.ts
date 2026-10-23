/** The answer of a credit adjustment (RNX-227): the ledger entry it wrote; a replay of the same key answers the same entry. */
export type CreditAdjustmentEntry = {
  readonly entryId: string;
  readonly accountId: string;
  readonly wallet: string;
  /** Signed credits as a decimal string: negative for a removal. */
  readonly amount: string;
  readonly balanceAfter: string;
  readonly adminId: string;
  readonly actionId: string | null;
  readonly createdAt: string;
};
