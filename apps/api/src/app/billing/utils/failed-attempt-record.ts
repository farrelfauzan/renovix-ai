import { randomUUID } from "node:crypto";
import type { ServedBy } from "../../providers/types/served-by";
import type { UsageRecord } from "../types/usage-record";
import { tokensFromUsage } from "./tokens-from-usage";

/**
 * RNX-179 (docs/credits.md section 3.1 rule 6, D58): the usage entry of one attempt that failed with a 502 or 503 and
 * moved on to a fallback model. It is its own model call under the request's reservation: a new callId, the failed
 * model's slug, no tokens (the provider reported none), outcome provider_error, so it is charged 0 and nothing is
 * uncharged. The caller writes it with CreditService.recordUsage, which does not close the reservation.
 */
export function failedAttemptRecord(call: Omit<UsageRecord, "tokens" | "outcome">, failed: ServedBy): UsageRecord {
  return { ...call, callId: randomUUID(), modelId: failed.slug, tokens: tokensFromUsage(0, 0, 0), outcome: "provider_error" };
}
