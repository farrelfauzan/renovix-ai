import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { UsageRecord } from "../types/usage-record";
import { computeCallCredits } from "./compute-call-credits";

/**
 * Whether a usage entry already written for a callId records this same call (RX-22, I8): same outcome, model, tier,
 * rates and token counts, and so the same credits (charged + uncharged). A replay of the same call returns the first
 * entry; a different call under the same callId is a conflict.
 */
export function isSameUsage(entry: CreditLedgerEntry, record: UsageRecord): boolean {
  const { rates, tokens } = record;
  const sameRates =
    !!entry.rateNew?.equals(rates.rateNew) && !!entry.rateCached?.equals(rates.rateCached) && !!entry.rateOut?.equals(rates.rateOut);
  const sameTokens =
    entry.tokensNew === tokens.tokensNew && entry.tokensCached === tokens.tokensCached && entry.tokensOut === tokens.tokensOut;
  const entryCredits = entry.amount.negated().plus(entry.uncharged);
  return (
    entry.type === "usage" &&
    entry.outcome === record.outcome &&
    entry.modelId === record.modelId &&
    entry.tier === record.tier &&
    sameRates &&
    sameTokens &&
    entryCredits.equals(computeCallCredits(tokens, rates))
  );
}
