import { jakartaDay, startOfJakartaDay } from "./portal-tier.service";

describe("RX-10: free-tier day in Asia/Jakarta (WIB)", () => {
  it("changes day at 00:00 WIB (17:00 UTC)", () => {
    expect(jakartaDay(new Date("2026-10-08T16:59:59Z"))).toBe("2026-10-08");
    expect(jakartaDay(new Date("2026-10-08T17:00:00Z"))).toBe("2026-10-09");
  });

  it("starts the day at 00:00 WIB", () => {
    expect(
      startOfJakartaDay(new Date("2026-10-08T16:59:59Z")).toISOString(),
    ).toBe("2026-10-07T17:00:00.000Z");
    expect(
      startOfJakartaDay(new Date("2026-10-08T17:00:00Z")).toISOString(),
    ).toBe("2026-10-08T17:00:00.000Z");
  });
});
