import {
  BetterAuthTestApp,
  NOT_LIMITED,
  fourSignInStatuses,
  sessionIpAfterSignUp,
  startBetterAuthApp,
} from "../../test/better-auth-app";

// RNX-168 (D48, D148 option a): without CLIENT_IP_HEADER, better-auth tracks no client IP (disableIpTracking):
// X-Forwarded-For never picks a rate-limit bucket or the session's stored ipAddress. better-auth's limiter then
// skips its checks; the Nest throttler limits these routes per socket address (RX-155; the gate case in
// app.module.throttle.spec.ts). Real lib/auth and better-auth on the test database
// (test/real-better-auth.ts, test/better-auth-app.ts).
jest.mock("better-auth", () => require("../../test/real-better-auth").betterAuthWithLimiter());
jest.mock("better-auth/adapters/prisma", () =>
  require("../../test/real-better-auth").requireNative("better-auth/adapters/prisma"),
);
jest.mock("./auth", () => require("../../test/real-better-auth").loadLibAuth());

describe("RNX-168: without CLIENT_IP_HEADER, better-auth tracks no client IP (option a, disableIpTracking)", () => {
  let started: BetterAuthTestApp;

  beforeAll(async () => {
    started = await startBetterAuthApp();
  });

  afterAll(() => started?.app.close());

  it("AC4: X-Forwarded-For opens no better-auth bucket, constant or changing: better-auth limits no sign-in", async () => {
    const constant = await fourSignInStatuses(started.app, "10.0.0.2", () => ({ "x-forwarded-for": "203.0.113.41" }));
    const changing = await fourSignInStatuses(started.app, "10.0.0.2", (i) => ({ "x-forwarded-for": `203.0.113.${50 + i}` }));

    expect(constant).toEqual(NOT_LIMITED);
    expect(changing).toEqual(NOT_LIMITED);
  });

  it("AC4: a session created with a forged X-Forwarded-For stores no IP (empty ipAddress)", async () => {
    const ipAddress = await sessionIpAfterSignUp(started, "ac4@renovix.test", { "x-forwarded-for": "203.0.113.42" });

    expect(ipAddress).toBe("");
  });
});
