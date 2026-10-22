/** An admin's "mark unmatched as refunded" (RNX-35): who, which unmatched payment, and the note. */
export type RefundRequest = {
  readonly adminId: string;
  readonly unmatchedId: string;
  readonly note: string;
};
