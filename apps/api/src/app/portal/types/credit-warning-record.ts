import type { CreditWarningLevel } from "@generated/prisma/client.js";

/** RNX-329: one warning queued for an account in a purchase cycle (a `credit_warnings` row). */
export type CreditWarningRecord = {
  readonly accountId: string;
  readonly level: CreditWarningLevel;
  readonly cycleStartedAt: Date;
};
