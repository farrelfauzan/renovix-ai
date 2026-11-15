import type { Prisma } from "@generated/prisma/client.js";

/** RNX-30-A: one account's usage since a given instant: the credits spent (positive) and the distinct local days with a charge. */
export type PaidUsageSummary = {
  readonly spent: Prisma.Decimal;
  readonly usageDays: number;
};
