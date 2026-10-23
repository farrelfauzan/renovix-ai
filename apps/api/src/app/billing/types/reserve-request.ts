import type { Prisma } from "@generated/prisma/client.js";

/**
 * A hold to place on a user's paid wallet for one request (docs/credits.md section 3.1 rule 2), in whole micro-credits.
 * RNX-232: a request made with an API key names the key (its monthly cap is checked, the hold records it).
 */
export type ReserveRequest = {
  readonly userId: string;
  readonly requestId: string;
  readonly amount: Prisma.Decimal;
  readonly apiKeyId?: string;
};
