import { RATE_REFRESH_RETRY_AFTER_MINUTES } from "../config/rate-refresh-retry-after-minutes";
import type { RetryGapInput } from "../types/retry-gap-input";

const MS_PER_MINUTE = 60_000;

/** Whether a failed refresh happened less than RATE_REFRESH_RETRY_AFTER_MINUTES ago, so no new fetch may start yet (RNX-53). */
export function isInRetryGap({ lastFailedAt, now }: RetryGapInput): boolean {
  return lastFailedAt !== null && now.getTime() - lastFailedAt.getTime() < RATE_REFRESH_RETRY_AFTER_MINUTES * MS_PER_MINUTE;
}
