import { Decimal } from "@prisma/client/runtime/client";
import type { FloorCheckInput } from "../types/floor-check-input";

/**
 * RNX-30-A (D47, D352 4): the floor flag, whatever the projection: paid available below runOutFloorCredits, or below
 * perRunCreditCap times the due reminders. A setting that is not set skips its part.
 */
export function isBelowFloor(input: FloorCheckInput): boolean {
  const { paidAvailable, floorCredits, perRunCreditCap } = input;
  if (floorCredits !== null && paidAvailable.lt(floorCredits)) return true;
  return perRunCreditCap !== null && paidAvailable.lt(new Decimal(perRunCreditCap).mul(input.dueReminderCount));
}
