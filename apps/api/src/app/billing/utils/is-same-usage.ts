import { Decimal } from "@prisma/client/runtime/client";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import type { UsageRecord } from "../types/usage-record";
import { computeCallCredits } from "./compute-call-credits";

/**
 * Whether the usage entries already written for a callId record this same call (RX-22, I8): each has the same outcome,
 * model, tier, rates and token counts, and together the same credits (charged + uncharged). RNX-58a: a call charged to
 * two wallets has one entry per wallet. A replay of the same call returns the first entries; a different call under the
 * same callId is a conflict.
 */
export function isSameUsage(entries: readonly CreditLedgerEntry[], record: UsageRecord): boolean {
  const { rates, tokens } = record;
  const isSameCall = (entry: CreditLedgerEntry): boolean =>
    entry.type === "usage" &&
    entry.outcome === record.outcome &&
    entry.modelId === record.modelId &&
    entry.tier === record.tier &&
    !!entry.rateNew?.equals(rates.rateNew) &&
    !!entry.rateCached?.equals(rates.rateCached) &&
    !!entry.rateOut?.equals(rates.rateOut) &&
    entry.tokensNew === tokens.tokensNew &&
    entry.tokensCached === tokens.tokensCached &&
    entry.tokensOut === tokens.tokensOut;
  const entriesCredits = entries.reduce((sum, entry) => sum.plus(entry.amount.negated()).plus(entry.uncharged), new Decimal(0));
  return entries.length > 0 && entries.every(isSameCall) && entriesCredits.equals(computeCallCredits(tokens, rates));
}
