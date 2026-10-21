import type { Decimal } from "@prisma/client/runtime/client";

/** One fetched rate to store (RNX-53). */
export type NewExchangeRate = {
  readonly base: string;
  readonly quote: string;
  readonly rate: Decimal;
  readonly rateDate: Date;
  readonly fetchedAt: Date;
  readonly source: string;
};
