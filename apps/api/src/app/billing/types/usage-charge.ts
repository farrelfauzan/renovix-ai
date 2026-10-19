import type { Prisma } from "@generated/prisma/client.js";

/**
 * How one call's credits are taken (docs/credits.md section 3.1 rule 4): from the reservation's hold, then the
 * overrun from the available balance, and what neither covers is recorded as uncharged. All whole micro-credits.
 */
export type UsageCharge = {
  readonly fromHold: Prisma.Decimal;
  readonly fromAvailable: Prisma.Decimal;
  readonly uncharged: Prisma.Decimal;
};
