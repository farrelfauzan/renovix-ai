/** The response of a credit adjustment (RNX-227): its ledger entry. A replay answers the same entry. */
export type CreditAdjustmentView = {
  readonly entryId: string;
  readonly accountId: string;
  readonly wallet: string;
  /** Signed credits as a decimal string: negative for a removal. */
  readonly amount: string;
  readonly balanceAfter: string;
  /** The admin who made the adjustment (the entry's memberUserId). */
  readonly adminId: string;
  /** The back-office action id (the entry's reference): the request id of the audit row that holds the reason. */
  readonly actionId: string | null;
  readonly createdAt: Date;
};
