import type { Decimal } from "@prisma/client/runtime/client";

/** A USD price in cents and the USD to IDR rate to convert it at (RNX-53). */
export type UsdToRupiahInput = {
  readonly usdCents: number;
  readonly rate: Decimal;
};
