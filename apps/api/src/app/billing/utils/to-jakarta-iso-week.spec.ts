import { toJakartaIsoWeek } from "./to-jakarta-iso-week";

// RNX-321: the weekly reset's idempotency key is the ISO week on the Asia/Jakarta calendar.

describe("toJakartaIsoWeek (RNX-321)", () => {
  it.each([
    ["Monday 2026-12-28 00:00 WIB", "2026-12-28T00:00:00+07:00", "2026-W53"],
    ["Friday 2027-01-01 12:00 WIB", "2027-01-01T12:00:00+07:00", "2026-W53"],
    ["the last instant of Sunday 2027-01-03 WIB", "2027-01-03T23:59:59.999+07:00", "2026-W53"],
    ["Monday 2027-01-04 00:00 WIB", "2027-01-04T00:00:00+07:00", "2027-W01"],
    ["Monday 2025-12-29, the week of Thursday 2026-01-01", "2025-12-29T10:00:00+07:00", "2026-W01"],
    ["Monday 2026-01-05 (zero-padded week)", "2026-01-05T08:00:00+07:00", "2026-W02"],
    ["Saturday 2026-11-28", "2026-11-28T15:00:00+07:00", "2026-W48"],
  ])("%s is %s", (_label, inputInstant, expectedWeek) => {
    const actualWeek = toJakartaIsoWeek(new Date(inputInstant));

    expect(actualWeek).toBe(expectedWeek);
  });

  it("Monday 00:00 WIB is still Sunday in UTC, and already counts as the new week", () => {
    const inputMonday = new Date("2026-11-30T00:00:00+07:00");
    const inputJustBefore = new Date(inputMonday.getTime() - 1);

    expect(inputMonday.toISOString()).toBe("2026-11-29T17:00:00.000Z");
    expect(toJakartaIsoWeek(inputMonday)).toBe("2026-W49");
    expect(toJakartaIsoWeek(inputJustBefore)).toBe("2026-W48");
  });
});
