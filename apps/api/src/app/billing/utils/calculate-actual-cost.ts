import { Decimal } from "@prisma/client/runtime/client";

/**
 * Calculate actual cost from provider usage response, including credit multiplier.
 */
export function calculateActualCost(
  inputTokens: number,
  outputTokens: number,
  inputPrice: number,
  outputPrice: number,
  creditMultiplier: number,
): Decimal {
  const inputCost = new Decimal(inputTokens).mul(new Decimal(inputPrice));
  const outputCost = new Decimal(outputTokens).mul(new Decimal(outputPrice));
  return inputCost.add(outputCost).mul(new Decimal(creditMultiplier));
}
