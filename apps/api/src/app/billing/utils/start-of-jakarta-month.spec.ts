import { startOfJakartaMonth } from "./start-of-jakarta-month";

describe("startOfJakartaMonth (RNX-232: the Asia/Jakarta calendar month of a key's monthly cap)", () => {
  it.each([
    // The last day of October in Jakarta (UTC+7): 23:59:59 WIB on 31 October is 16:59:59Z, still October.
    ["2026-10-31T16:59:59.999Z", "2026-09-30T17:00:00.000Z"],
    // 00:00 WIB on 1 November is 17:00Z on 31 October: the UTC date is still October, the Jakarta month is November.
    ["2026-10-31T17:00:00.000Z", "2026-10-31T17:00:00.000Z"],
    ["2026-10-31T23:30:00.000Z", "2026-10-31T17:00:00.000Z"],
    // The first hours of a UTC month are still in it in Jakarta.
    ["2026-11-01T00:00:00.000Z", "2026-10-31T17:00:00.000Z"],
    // The year boundary: 1 January 00:00 WIB is 17:00Z on 31 December.
    ["2026-12-31T17:00:00.000Z", "2026-12-31T17:00:00.000Z"],
    ["2026-12-31T16:59:59.000Z", "2026-11-30T17:00:00.000Z"],
  ])("%s is in the Jakarta month that starts at %s", (input, expected) => {
    const actual = startOfJakartaMonth(new Date(input));

    expect(actual.toISOString()).toBe(expected);
  });
});
