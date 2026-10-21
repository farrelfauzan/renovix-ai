import { RATE_REFRESH_RETRY_AFTER_MINUTES } from "../config/rate-refresh-retry-after-minutes";
import { isInRetryGap } from "./is-in-retry-gap";

// RNX-53: after a failed refresh, no new fetch for RATE_REFRESH_RETRY_AFTER_MINUTES.
describe("isInRetryGap (RNX-53)", () => {
  const inputNow = new Date("2026-10-21T12:00:00.000Z");
  const minutesBefore = (minutes: number): Date => new Date(inputNow.getTime() - minutes * 60_000);

  it.each([
    ["no failed refresh", null, false],
    ["a failure 1 minute ago", minutesBefore(1), true],
    ["a failure exactly RATE_REFRESH_RETRY_AFTER_MINUTES ago", minutesBefore(RATE_REFRESH_RETRY_AFTER_MINUTES), false],
    ["a failure 6 minutes ago", minutesBefore(6), false],
  ])("%s", (_case, inputLastFailedAt, expected) => {
    const actual = isInRetryGap({ lastFailedAt: inputLastFailedAt, now: inputNow });
    expect(actual).toBe(expected);
  });
});
