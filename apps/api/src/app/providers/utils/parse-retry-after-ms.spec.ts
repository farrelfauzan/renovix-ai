import { parseRetryAfterMs } from "./parse-retry-after-ms";

describe("parseRetryAfterMs (RX-161)", () => {
  const now = Date.parse("2026-10-16T10:00:00Z");

  it("seconds", () => {
    expect(parseRetryAfterMs("30", now)).toBe(30000);
  });

  it("an HTTP date", () => {
    expect(parseRetryAfterMs("Fri, 16 Oct 2026 10:00:12 GMT", now)).toBe(12000);
  });

  it.each([null, "", "soon"])("negative: %j → undefined", (value) => {
    expect(parseRetryAfterMs(value, now)).toBeUndefined();
  });
});
