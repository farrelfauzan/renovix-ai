import { Decimal } from "@prisma/client/runtime/client";

/** 1,000,000: the tier rates are credits per 1,000,000 tokens (docs/credits.md section 1). */
const TOKENS_PER_RATE_UNIT = 1_000_000;

/**
 * Estimate the credits of an estimated token count from the tier's input rate (RX-21). The rate is
 * the tier's credits-per-1,000,000-tokens figure (docs/credits.md section 1.3):
 * credits = tokens x rate / 1,000,000.
 */
export function estimateCost(
  estimatedTokens: number,
  inputCreditsPerMillionTokens: number,
): Decimal {
  return new Decimal(estimatedTokens)
    .mul(new Decimal(inputCreditsPerMillionTokens))
    .div(TOKENS_PER_RATE_UNIT);
}
