import { MAX_RATE_AGE_DAYS } from "../config/max-rate-age-days";
import type { RateAgeInput } from "../types/rate-age-input";

const MS_PER_DAY = 86_400_000;

/** Whether a rate's own date lies more than MAX_RATE_AGE_DAYS calendar days before today (UTC) (RNX-53). */
export function isRateTooOld({ rateDate, now }: RateAgeInput): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - rateDate.getTime()) / MS_PER_DAY) > MAX_RATE_AGE_DAYS;
}
