import { RATE_REFRESH_AFTER_HOURS } from "../config/rate-refresh-after-hours";
import type { RefreshDueInput } from "../types/refresh-due-input";

const MS_PER_HOUR = 3_600_000;

/** Whether a rate fetched at `fetchedAt` is due a refresh: fetched more than RATE_REFRESH_AFTER_HOURS ago (RNX-53, D237). */
export function isRefreshDue({ fetchedAt, now }: RefreshDueInput): boolean {
  return now.getTime() - fetchedAt.getTime() > RATE_REFRESH_AFTER_HOURS * MS_PER_HOUR;
}
