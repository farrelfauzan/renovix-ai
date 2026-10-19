import { Decimal } from "@prisma/client/runtime/client";
import type { CallRates } from "../types/call-rates";
import type { CallTokens } from "../types/call-tokens";
import { MicroCreditMath } from "./micro-credit-math";

/**
 * The credits of one model call (docs/credits.md sections 1.3 and 2.3, D115 item 3): new x new rate + cached x cached
 * rate + output x output rate, computed exactly (a rate is credits per 1,000,000 tokens, so the sum is in
 * micro-credits) and rounded once, up, to a whole micro-credit. Refuses a token count that is not a non-negative
 * safe integer and a rate that is not finite and non-negative, so no bad value becomes a NaN or negative charge.
 */
export function computeCallCredits(tokens: CallTokens, rates: CallRates): Decimal {
  const counts = [tokens.tokensNew, tokens.tokensCached, tokens.tokensOut];
  const callRates = [rates.rateNew, rates.rateCached, rates.rateOut];
  if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0) || !callRates.every((rate) => rate.isFinite() && !rate.isNegative())) {
    throw new Error("Token counts must be non-negative integers and rates finite and non-negative");
  }
  const microCredits = new MicroCreditMath(tokens.tokensNew)
    .mul(rates.rateNew.toString())
    .add(new MicroCreditMath(tokens.tokensCached).mul(rates.rateCached.toString()))
    .add(new MicroCreditMath(tokens.tokensOut).mul(rates.rateOut.toString()));
  return new Decimal(microCredits.toDecimalPlaces(0, MicroCreditMath.ROUND_CEIL).toFixed(0)).div(1_000_000);
}
