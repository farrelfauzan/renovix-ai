import { RATE_REFRESH_AFTER_HOURS } from "../config/rate-refresh-after-hours";
import { isRefreshDue } from "./is-refresh-due";

// RNX-53 (D237): a rate fetched more than RATE_REFRESH_AFTER_HOURS ago is refreshed before use.
describe("isRefreshDue (RNX-53)", () => {
  const inputNow = new Date("2026-10-21T12:00:00.000Z");
  const hoursBefore = (hours: number): Date => new Date(inputNow.getTime() - hours * 3_600_000);

  it.each([
    ["fetched 1 hour ago", 1, false],
    ["fetched exactly RATE_REFRESH_AFTER_HOURS ago", RATE_REFRESH_AFTER_HOURS, false],
    ["fetched 25 hours ago", 25, true],
  ])("%s", (_case, inputHours, expected) => {
    const actual = isRefreshDue({ fetchedAt: hoursBefore(inputHours), now: inputNow });
    expect(actual).toBe(expected);
  });
});
