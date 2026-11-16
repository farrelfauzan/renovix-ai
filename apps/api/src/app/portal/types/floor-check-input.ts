import type { Prisma } from "@generated/prisma/client.js";

/** RNX-30-A: what `isBelowFloor` needs. A setting that is not set is null, and its part of the check is skipped. */
export type FloorCheckInput = {
  /** The paid wallet's available credits (balance - held). */
  readonly paidAvailable: Prisma.Decimal;
  /** Platform setting runOutFloorCredits. */
  readonly floorCredits: number | null;
  /** Platform setting perRunCreditCap: what one due reminder needs (D352 4). */
  readonly perRunCreditCap: number | null;
  /** The user's due reminders (see `dueReminderWindow`). */
  readonly dueReminderCount: number;
};
