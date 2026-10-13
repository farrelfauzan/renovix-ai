import { Decimal } from "@prisma/client/runtime/client";

/**
 * Estimate cost based on estimated input tokens, model pricing, and credit multiplier.
 */
export function estimateCost(
  estimatedTokens: number,
  inputPrice: number,
  creditMultiplier: number,
): Decimal {
  return new Decimal(estimatedTokens)
    .mul(new Decimal(inputPrice))
    .mul(new Decimal(creditMultiplier));
}
