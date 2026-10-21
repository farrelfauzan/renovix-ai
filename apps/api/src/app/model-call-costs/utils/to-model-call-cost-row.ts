import type { Prisma } from "@generated/prisma/client.js";
import type { ModelCallCostRowInput } from "../types/model-call-cost-row-input";
import { computeCallCost } from "./compute-call-cost";

/**
 * RNX-162: the model_call_costs row of one call: its usage entry's call id, wallet and tier, the served model and
 * provider record, the entry's tokens with the reported reasoning tokens, the reported cost, what computeCallCost
 * makes of them, and the rate used. No prompt or answer content.
 */
export function toModelCallCostRow({ entry, record, source, rate }: ModelCallCostRowInput): Prisma.ModelCallCostUncheckedCreateInput {
  const basis = source.servedBy.costBasis ?? null;
  const reportedCostUsd = source.usage?.costUsd ?? null;
  return {
    callId: record.callId,
    providerId: basis?.providerRecordId ?? null,
    providerModelId: source.servedBy.slug,
    ...record.tokens,
    tokensReasoning: source.usage?.reasoningTokens ?? null,
    reportedCostUsd,
    ...computeCallCost({ tokens: record.tokens, reportedCostUsd, basis, rate: rate?.rate ?? null }),
    exchangeRate: rate?.rate ?? null,
    exchangeRateDate: rate?.rateDate ?? null,
    wallet: entry.wallet,
    workspaceId: source.workspaceId ?? null,
    tier: record.tier,
  };
}
