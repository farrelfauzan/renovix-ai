import type { CreditMeter } from "@/hooks/use-credit-meter";
import { isFreeCreditUser } from "@/lib/is-free-credit-user";

/**
 * Which credit banner the meter calls for: red or amber by the API's level, else the floor warning when the floor
 * flag is set. A free user gets none, even with `belowFloor: true` (D360).
 */
export function pickCreditBanner(meter: CreditMeter): "red" | "amber" | "floor" | null {
  if (isFreeCreditUser(meter)) return null;
  if (meter.level !== "none") return meter.level;
  return meter.belowFloor ? "floor" : null;
}
