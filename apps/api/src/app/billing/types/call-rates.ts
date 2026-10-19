import type { Prisma } from "@generated/prisma/client.js";

/** One tier's rates, in credits per 1,000,000 tokens of each kind (docs/credits.md section 1.2), copied onto a usage entry. */
export type CallRates = {
  readonly rateNew: Prisma.Decimal;
  readonly rateCached: Prisma.Decimal;
  readonly rateOut: Prisma.Decimal;
};
