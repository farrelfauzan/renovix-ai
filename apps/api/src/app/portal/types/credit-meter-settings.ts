/** RNX-30-A: the platform settings the credit meter reads; a setting that is not set is null. */
export type CreditMeterSettings = {
  readonly projectionMinSpendCredits: number | null;
  readonly projectionMaxDays: number | null;
  readonly runOutAmberDays: number | null;
  readonly runOutRedDays: number | null;
  readonly runOutFloorCredits: number | null;
  readonly perRunCreditCap: number | null;
};
