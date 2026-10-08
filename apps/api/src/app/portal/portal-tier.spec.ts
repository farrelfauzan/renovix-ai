import { clientIp, jakartaDay, startOfJakartaDay } from "./portal-tier.service";

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

describe("RX-10: clientIp", () => {
  const original = process.env.CLIENT_IP_HEADER;
  afterEach(() => {
    if (original === undefined) delete process.env.CLIENT_IP_HEADER;
    else process.env.CLIENT_IP_HEADER = original;
  });

  const forged = {
    "x-forwarded-for": "1.2.3.4, 9.9.9.9",
    "x-client-ip": "5.6.7.8",
    "x-real-ip": "6.6.6.6",
  };

  it("without CLIENT_IP_HEADER, client-sent IP headers are ignored (socket address)", () => {
    delete process.env.CLIENT_IP_HEADER;

    expect(
      clientIp({
        headers: forged,
        raw: { socket: { remoteAddress: "10.0.0.1" } },
      }),
    ).toBe("10.0.0.1");
    expect(
      clientIp({ headers: forged, socket: { remoteAddress: "10.0.0.2" } }),
    ).toBe("10.0.0.2");
  });

  it("with CLIENT_IP_HEADER, only that header is used", () => {
    process.env.CLIENT_IP_HEADER = "X-Client-IP";

    expect(
      clientIp({
        headers: forged,
        raw: { socket: { remoteAddress: "10.0.0.1" } },
      }),
    ).toBe("5.6.7.8");
    expect(
      clientIp({ headers: { "x-client-ip": [" 7.7.7.7 ", "8.8.8.8"] } }),
    ).toBe("7.7.7.7");
  });

  it('with CLIENT_IP_HEADER and the header missing, returns "unknown"', () => {
    process.env.CLIENT_IP_HEADER = "x-client-ip";

    expect(
      clientIp({
        headers: { "x-forwarded-for": "1.2.3.4" },
        raw: { socket: { remoteAddress: "10.0.0.1" } },
      }),
    ).toBe("unknown");
  });
});
