/** The orders of one Jakarta day by status and by flag, and the unmatched payments received that day (RNX-35, AC19). */
export type OrderDayCounts = {
  readonly pending: number;
  readonly paid: number;
  readonly late: number;
  readonly expired: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly unmatched: number;
  readonly amount_mismatch: number;
  readonly unconfirmed: number;
  readonly webhook_missed: number;
  readonly needs_review: number;
};
