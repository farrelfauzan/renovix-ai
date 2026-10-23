import type { Decimal } from "@prisma/client/runtime/client";

/** A Decimal as a plain decimal string, never in exponent notation ("0.000000012", not "1.2e-8"). */
export function toAmount(value: Decimal): string {
  return value.toFixed();
}
