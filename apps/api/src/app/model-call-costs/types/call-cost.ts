import type { Decimal } from "@prisma/client/runtime/client";

/**
 * RNX-162: what one call cost us. tokenPriceUsd is null when the model's prices are unknown; the low and high USD
 * figures are null only when there is neither a reported cost nor a token-price figure; the rupiah figures are null
 * when no usable rate exists.
 */
export type CallCost = {
  readonly tokenPriceUsd: Decimal | null;
  readonly costLowUsd: Decimal | null;
  readonly costHighUsd: Decimal | null;
  readonly costLowIdr: Decimal | null;
  readonly costHighIdr: Decimal | null;
};
