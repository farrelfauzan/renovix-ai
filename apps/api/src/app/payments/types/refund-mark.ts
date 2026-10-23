/** Who marked an unmatched payment refunded, when, and the note they wrote (RNX-35). */
export type RefundMark = {
  readonly adminId: string;
  readonly at: Date;
  readonly note: string;
};
