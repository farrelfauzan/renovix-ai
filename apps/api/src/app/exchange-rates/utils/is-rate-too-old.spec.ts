import { MAX_RATE_AGE_DAYS } from "../config/max-rate-age-days";
import { isRateTooOld } from "./is-rate-too-old";

// RNX-53: a rate exactly MAX_RATE_AGE_DAYS calendar days old (UTC) is still used; one day older is refused.
describe("isRateTooOld (RNX-53)", () => {
  const inputNow = new Date("2026-10-21T23:59:00.000Z");
  const daysBefore = (days: number): Date => new Date(Date.UTC(2026, 9, 21 - days));

  it.each([
    ["today's rate", 0, false],
    ["a rate exactly MAX_RATE_AGE_DAYS old", MAX_RATE_AGE_DAYS, false],
    ["a rate one day older than MAX_RATE_AGE_DAYS", MAX_RATE_AGE_DAYS + 1, true],
  ])("%s", (_case, inputAgeDays, expected) => {
    const actual = isRateTooOld({ rateDate: daysBefore(inputAgeDays), now: inputNow });
    expect(actual).toBe(expected);
  });

  it("judges by the UTC calendar day, not by 24-hour periods", () => {
    const inputEarlyNow = new Date("2026-10-21T00:01:00.000Z");
    const actual = isRateTooOld({ rateDate: daysBefore(MAX_RATE_AGE_DAYS), now: inputEarlyNow });
    expect(actual).toBe(false);
  });
});
