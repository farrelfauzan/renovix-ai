import { Decimal } from "@prisma/client/runtime/client";

/** 1,000,000: the tier rates are credits per 1,000,000 tokens (docs/credits.md section 1). */
const TOKENS_PER_RATE_UNIT = 1_000_000;

/**
 * Calculate the actual credits from the provider usage and the tier's rates (RX-21), exactly as
 * docs/credits.md section 1.3 defines: (new input x input rate + cached input x cached rate +
 * output x output rate) / 1,000,000. Each rate is the tier's credits-per-1,000,000-tokens figure.
 * `cachedTokens` (when the provider reports them) are priced at the cached rate instead of the
 * input rate; without a report they are priced as input.
 */
export function calculateActualCost(
  inputTokens: number,
  outputTokens: number,
  inputCreditsPerMillionTokens: number,
  outputCreditsPerMillionTokens: number,
  cachedTokens = 0,
  cachedCreditsPerMillionTokens = inputCreditsPerMillionTokens,
): Decimal {
  const freshInputTokens = Math.max(0, inputTokens - cachedTokens);
  return new Decimal(freshInputTokens)
    .mul(new Decimal(inputCreditsPerMillionTokens))
    .add(new Decimal(cachedTokens).mul(new Decimal(cachedCreditsPerMillionTokens)))
    .add(new Decimal(outputTokens).mul(new Decimal(outputCreditsPerMillionTokens)))
    .div(TOKENS_PER_RATE_UNIT);
}
