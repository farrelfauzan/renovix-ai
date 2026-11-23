import type { Prisma } from "@generated/prisma/client.js";
import type { PaidUsageSummary } from "../../billing/types/paid-usage-summary";
import type { CreditMeterSettings } from "./credit-meter-settings";

/** RNX-329: what `evaluateCreditMeter` needs about one paid wallet. A setting that is not set is null. */
export type CreditMeterEvaluationInput = {
  readonly now: Date;
  /** The paid wallet's available credits (balance - held). */
  readonly paidAvailable: Prisma.Decimal;
  /** The paid wallet's usage in the projection window. */
  readonly usage: PaidUsageSummary;
  /** The profile timezone (see `resolveProfileTimeZone`). */
  readonly timeZone: string;
  /** The user's due reminders (see `dueReminderWindow`). */
  readonly dueReminderCount: number;
  readonly settings: CreditMeterSettings;
};
