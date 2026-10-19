import { Decimal } from "@prisma/client/runtime/client";
import type { CallRates } from "../types/call-rates";
import { MicroCreditMath } from "./micro-credit-math";

/**
 * The estimate E of one model call (docs/credits.md section 3.1 rule 1): I x max(new rate, cached rate) + M x output
 * rate, rounded up to a whole micro-credit, where I is the counted prompt and M the call's resolved max_tokens. The
 * larger input rate is used because cached input can cost more than new input (Advanced, Premium).
 */
export function estimateCallCredits(promptTokens: number, maxTokens: number, rates: CallRates): Decimal {
  const inputRate = Decimal.max(rates.rateNew, rates.rateCached);
  const microCredits = new MicroCreditMath(promptTokens)
    .mul(inputRate.toString())
    .add(new MicroCreditMath(maxTokens).mul(rates.rateOut.toString()));
  return new Decimal(microCredits.toDecimalPlaces(0, MicroCreditMath.ROUND_CEIL).toFixed(0)).div(1_000_000);
}
