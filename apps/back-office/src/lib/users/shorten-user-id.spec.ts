import { formatDateTime } from "./format-date-time";
import { shortenUserId } from "./shorten-user-id";

describe("shortenUserId", () => {
  it("keeps the first eight characters of a long id and marks the cut", () => {
    expect(shortenUserId("0f3c9a2e-7b41-4d6a-9c0e-5a1b2c3d4e01")).toBe("0f3c9a2e…");
  });

  it("shows a short id whole", () => {
    expect(shortenUserId("user-70")).toBe("user-70");
  });
});

describe("formatDateTime", () => {
  it("shows day, month, year and time, not the raw ISO text", () => {
    const actual = formatDateTime("2026-11-20T08:00:00.000Z");
    expect(actual).toMatch(/^\d{1,2} Nov 2026, \d{2}:\d{2}$/);
  });
});
