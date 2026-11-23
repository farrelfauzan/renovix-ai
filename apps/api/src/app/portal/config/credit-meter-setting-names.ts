import type { CreditMeterSettings } from "../types/credit-meter-settings";

/**
 * The platform settings the credit meter (RNX-30-A) and the run-out warning check (RNX-329) read, in the order a
 * missing one is named in the log.
 */
export const CREDIT_METER_SETTING_NAMES = [
  "projectionMinSpendCredits",
  "projectionMaxDays",
  "runOutAmberDays",
  "runOutRedDays",
  "runOutFloorCredits",
  "perRunCreditCap",
] as const satisfies ReadonlyArray<keyof CreditMeterSettings>;
