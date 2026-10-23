import { jakartaDayRange } from "./jakarta-day-range";
import { toJakartaDay } from "./to-jakarta-day";

describe("Jakarta payment days (RNX-35)", () => {
  it("a Jakarta day runs from 17:00 UTC the day before to 17:00 UTC", () => {
    expect(jakartaDayRange("2026-10-22")).toEqual({ start: new Date("2026-10-21T17:00:00.000Z"), end: new Date("2026-10-22T17:00:00.000Z") });
  });

  it.each([
    ["2026-10-21T16:59:59.999Z", "2026-10-21"],
    ["2026-10-21T17:00:00.000Z", "2026-10-22"],
    ["2026-10-22T16:59:59.999Z", "2026-10-22"],
  ])("%s is Jakarta day %s", (at, day) => {
    expect(toJakartaDay(new Date(at))).toBe(day);
  });
});
