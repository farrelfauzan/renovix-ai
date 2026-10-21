import { Decimal } from "@prisma/client/runtime/client";
import { RUPIAH_ROUNDING_STEP } from "../config/rupiah-rounding-step";
import type { UsdToRupiahInput } from "../types/usd-to-rupiah-input";

const CENTS_PER_DOLLAR = 100;

/**
 * The rupiah amount of a USD price (RNX-53, D235): cents x rate / 100, rounded up to the next RUPIAH_ROUNDING_STEP.
 * Exact decimal arithmetic; nothing is rounded before the final step.
 */
export function convertUsdCentsToRupiah({ usdCents, rate }: UsdToRupiahInput): number {
  const rupiah = new Decimal(usdCents).mul(rate).div(CENTS_PER_DOLLAR);
  return rupiah.div(RUPIAH_ROUNDING_STEP).ceil().mul(RUPIAH_ROUNDING_STEP).toNumber();
}
