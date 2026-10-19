import { Decimal } from "@prisma/client/runtime/client";
import type { UsageCharge } from "../types/usage-charge";

/**
 * Splits a call's credits (docs/credits.md section 3.1 rule 4): taken from the remaining hold first, the overrun from
 * the available balance, and whatever the available balance cannot cover is uncharged, so no balance goes below 0
 * (I5). All amounts are whole micro-credits.
 */
export function splitUsageCharge(amount: Decimal, remainingHold: Decimal, available: Decimal): UsageCharge {
  const fromHold = Decimal.min(amount, remainingHold);
  const fromAvailable = Decimal.min(amount.minus(fromHold), Decimal.max(available, 0));
  return { fromHold, fromAvailable, uncharged: amount.minus(fromHold).minus(fromAvailable) };
}
