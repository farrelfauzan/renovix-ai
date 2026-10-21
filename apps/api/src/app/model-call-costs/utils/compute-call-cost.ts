import { Decimal } from "@prisma/client/runtime/client";
import type { CallTokens } from "../../billing/types/call-tokens";
import type { CallCostBasis } from "../../providers/types/call-cost-basis";
import type { CallCost } from "../types/call-cost";
import type { CallCostInput } from "../types/call-cost-input";

/**
 * new x input + cached x cached input + output x output price, in USD. A model with no cached price prices its cached
 * tokens at the input price (a conservative upper bound). Reasoning tokens are part of the output tokens.
 */
const tokenPriceOf = ({ tokensNew, tokensCached, tokensOut }: CallTokens, basis: CallCostBasis): Decimal =>
  basis.inputPrice
    .mul(tokensNew)
    .plus((basis.cachedInputPrice ?? basis.inputPrice).mul(tokensCached))
    .plus(basis.outputPrice.mul(tokensOut));

/** The provider's high-case factor when it applies: factor and threshold both set and the call's total tokens above it. */
const highCaseFactorOf = ({ tokensNew, tokensCached, tokensOut }: CallTokens, basis: CallCostBasis | null): Decimal | null => {
  if (basis?.highCaseFactor == null || basis.highCaseTokenThreshold == null) return null;
  return tokensNew + tokensCached + tokensOut > basis.highCaseTokenThreshold ? basis.highCaseFactor : null;
};

/**
 * RNX-162: what one model call cost us, in Decimal throughout.
 * - token price = new x input + cached x cached input (the input price when the model has none) + output x output;
 * - low = the reported cost x the provider's multiplier (1 when unset) when the provider reported a cost, else the
 *   token price; then at least the provider's per-call floor when one is set;
 * - high = low x the provider's high-case factor when it is set and the call's total tokens exceed its threshold,
 *   else low;
 * - rupiah = USD x the rate, null without a usable rate.
 */
export function computeCallCost({ tokens, reportedCostUsd, basis, rate }: CallCostInput): CallCost {
  const tokenPriceUsd = basis && tokenPriceOf(tokens, basis);
  const estimate = reportedCostUsd ? reportedCostUsd.mul(basis?.costMultiplier ?? 1) : tokenPriceUsd;
  const floor = basis?.perCallFloorUsd;
  const costLowUsd = estimate && floor ? Decimal.max(estimate, floor) : estimate;
  const highCaseFactor = highCaseFactorOf(tokens, basis);
  const costHighUsd = costLowUsd && highCaseFactor ? costLowUsd.mul(highCaseFactor) : costLowUsd;
  return {
    tokenPriceUsd,
    costLowUsd,
    costHighUsd,
    costLowIdr: rate && costLowUsd && costLowUsd.mul(rate),
    costHighIdr: rate && costHighUsd && costHighUsd.mul(rate),
  };
}
