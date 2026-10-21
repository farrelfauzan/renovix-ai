/** When this instance's last rate refresh failed (null when the last one succeeded or none failed), and the moment to judge at (RNX-53). */
export type RetryGapInput = {
  readonly lastFailedAt: Date | null;
  readonly now: Date;
};
