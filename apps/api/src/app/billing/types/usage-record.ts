import type { CreditCallOutcome } from "@generated/prisma/client.js";
import type { CallRates } from "./call-rates";
import type { CallTokens } from "./call-tokens";

/**
 * One model call to record against a reservation (docs/credits.md sections 2.1 and 3.1): the usage entry's fields.
 * `callId` is also the entry's idempotency key; `modelId` is the model's slug.
 */
export type UsageRecord = {
  readonly reservationId: string;
  readonly memberUserId: string;
  readonly requestId: string;
  readonly callId: string;
  readonly modelId: string;
  readonly tier: string;
  readonly rates: CallRates;
  readonly tokens: CallTokens;
  readonly outcome: CreditCallOutcome;
};
