import { formatRunOutLabel } from "./format-run-out-label";

describe("formatRunOutLabel (RNX-30-A, D352 Q4: DD/MM/YYYY HH:00 in the profile timezone)", () => {
  it.each([
    ["2026-11-15T10:59:59.999Z", "UTC", "15/11/2026 10:00"],
    ["2026-11-15T16:59:00.000Z", "Asia/Jakarta", "15/11/2026 23:00"],
    ["2026-11-15T17:00:00.000Z", "Asia/Jakarta", "16/11/2026 00:00"],
    ["2026-12-31T17:30:00.000Z", "Asia/Jakarta", "01/01/2027 00:00"],
    ["2026-11-15T10:45:00.000Z", "Asia/Kolkata", "15/11/2026 16:00"],
    ["2026-03-08T07:30:00.000Z", "America/New_York", "08/03/2026 03:00"],
  ])("%s in %s is %s", (input, timeZone, expected) => {
    const actual = formatRunOutLabel(new Date(input), timeZone);

    expect(actual).toBe(expected);
  });
});
