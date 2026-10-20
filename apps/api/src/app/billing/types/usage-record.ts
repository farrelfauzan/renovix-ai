import type { CreditCallOutcome } from "@generated/prisma/client.js";
import type { CallRates } from "./call-rates";
import type { CallTokens } from "./call-tokens";

/**
 * One model call to record against a reservation (docs/credits.md sections 2.1 and 3.1): the usage entry's fields.
 * `callId` is also the entry's idempotency key; `modelId` is the model's slug. In an agent run (section 13) the call
 * also names the run, the agent that made it and the caller's model call that started this hop (null for the root
 * agent's calls); outside a run they are left out.
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
  readonly runId?: string;
  readonly agentId?: string;
  readonly parentCallId?: string | null;
};
