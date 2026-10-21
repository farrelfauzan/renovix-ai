import {
  BetterAuthTestApp,
  LIMITED_ON_FOURTH,
  fourSignInStatuses,
  sessionIpAfterSignUp,
  startBetterAuthApp,
} from "../../test/better-auth-app";

// RNX-168 (D48): with CLIENT_IP_HEADER set, better-auth takes the client IP from that header only, never from
// X-Forwarded-For, for its rate limiter and the session's stored ipAddress. Real lib/auth and better-auth on
// the test database (test/real-better-auth.ts, test/better-auth-app.ts); its limiter is on, as in production.
jest.mock("better-auth", () => require("../../test/real-better-auth").betterAuthWithLimiter());
jest.mock("better-auth/adapters/prisma", () =>
  require("../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("./auth", () => require("../../test/real-better-auth").loadLibAuth("x-client-ip"));

describe("RNX-168: with CLIENT_IP_HEADER=x-client-ip, better-auth's client IP is that header only", () => {
  let started: BetterAuthTestApp;

  beforeAll(async () => {
    started = await startBetterAuthApp();
  });

  afterAll(async () => {
    delete process.env.CLIENT_IP_HEADER;
    await started?.app.close();
  });

  it("AC1: a constant client header with a different forged X-Forwarded-For each time shares one better-auth bucket: the 4th sign-in is 429", async () => {
    const statuses = await fourSignInStatuses(started.app, "10.0.0.1", (i) => ({
      "x-client-ip": "198.51.100.11",
      "x-forwarded-for": `203.0.113.${i}`,
    }));

    expect(statuses).toEqual(LIMITED_ON_FOURTH);
  });

  it("AC2: two clients with different header values through one socket each get their own better-auth bucket", async () => {
    const first = await fourSignInStatuses(started.app, "10.0.0.1", () => ({ "x-client-ip": "198.51.100.21" }));
    const second = await fourSignInStatuses(started.app, "10.0.0.1", () => ({ "x-client-ip": "198.51.100.22" }));

    expect(first).toEqual(LIMITED_ON_FOURTH);
    expect(second).toEqual(LIMITED_ON_FOURTH);
  });

  it("AC3: a session created with a forged X-Forwarded-For stores the client header's IP, not the forged one", async () => {
    const ipAddress = await sessionIpAfterSignUp(started, "ac3@renovix.test", {
      "x-client-ip": "198.51.100.31",
      "x-forwarded-for": "203.0.113.99",
    });

    expect(ipAddress).toBe("198.51.100.31");
  });
});
