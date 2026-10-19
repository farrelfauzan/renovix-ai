import type { TierRates } from "../../config/model-registry.service";
import type { CallRates } from "../types/call-rates";

/** A tier's rates (RX-21, credits per 1,000,000 tokens) as the rates a usage entry copies (docs/credits.md section 2.1). */
export function callRatesOf(tierRates: TierRates): CallRates {
  return {
    rateNew: tierRates.inputCreditsPerToken,
    rateCached: tierRates.cachedCreditsPerToken,
    rateOut: tierRates.outputCreditsPerToken,
  };
}
