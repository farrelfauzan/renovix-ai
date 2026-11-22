import { isIanaTimeZone } from "../../auth/utils/is-iana-time-zone";
import { RUN_OUT_PROJECTION } from "../config/run-out-projection";

/**
 * RNX-30-A: the timezone the projection counts days in: the stored profile timezone, or the default when there is none
 * or the database or Intl would reject it (not every write path validates it).
 */
export function resolveProfileTimeZone(stored: string | null | undefined): string {
  return stored && isIanaTimeZone(stored) ? stored : RUN_OUT_PROJECTION.defaultTimeZone;
}
