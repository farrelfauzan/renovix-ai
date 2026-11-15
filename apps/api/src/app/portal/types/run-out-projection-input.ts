import type { Prisma } from "@generated/prisma/client.js";

/** RNX-30-A: what `projectRunOut` needs. A setting that is not set is null. */
export type RunOutProjectionInput = {
  readonly now: Date;
  /** The paid wallet's available credits (balance - held). */
  readonly paidAvailable: Prisma.Decimal;
  /** Paid credits spent in the projection window, as a positive amount. */
  readonly spentInWindow: Prisma.Decimal;
  /** Distinct days with paid usage in the window, in the profile timezone. */
  readonly usageDays: number;
  readonly timeZone: string;
  /** Platform setting projectionMinSpendCredits. */
  readonly minSpendCredits: number | null;
  /** Platform setting projectionMaxDays. */
  readonly maxDays: number | null;
};
