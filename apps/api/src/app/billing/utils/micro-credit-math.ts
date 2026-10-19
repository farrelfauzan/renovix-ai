import { Decimal } from "@prisma/client/runtime/client";

/**
 * A Decimal with enough significant digits that tokens x rates (a rate has up to 12 decimal places) are exact,
 * so the only rounding is the one ceiling per call (docs/credits.md section 2.3).
 */
export const MicroCreditMath = Decimal.clone({ precision: 64 });
