/** RNX-30-A: what `creditMeterLevel` needs. A setting that is not set is null, and its check is skipped. */
export type CreditMeterLevelInput = {
  readonly now: Date;
  /** The projected run-out instant; null without a projected date. */
  readonly runOutAt: Date | null;
  /** Platform setting runOutAmberDays. */
  readonly amberDays: number | null;
  /** Platform setting runOutRedDays. */
  readonly redDays: number | null;
};
