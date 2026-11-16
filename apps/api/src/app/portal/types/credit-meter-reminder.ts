/** RNX-30-A: a scheduled run (an active reminder) listed by the credit meter in the red state. */
export type CreditMeterReminder = {
  readonly id: string;
  /** The reminder's human-readable label, if it has one. */
  readonly description: string | null;
  readonly nextRunAt: Date;
};
