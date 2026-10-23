import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { CombinedAuthGuard } from "./combined-auth.guard";

// RX-15 characterization: CombinedAuthGuard as it behaves today (no database).
// better-auth is ESM-only; its session lookup is a mock the tests program.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));


type TestRequest = { headers: Record<string, string>; user?: unknown };
const contextFor = (request: TestRequest) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

/** A JWT signed like a login token of POST /auth/login before RNX-225: with the app's JWT_SECRET (setup-env.ts's test value). */
const sign = (payload: object, secret = process.env.JWT_SECRET!, options: jwt.SignOptions = {}) =>
  jwt.sign(payload, secret, options);

describe("CombinedAuthGuard (RX-15 characterization)", () => {
  let guard: CombinedAuthGuard;

  beforeAll(() => {
    guard = new CombinedAuthGuard();
  });

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  const run = (headers: Record<string, string>) => {
    const request: TestRequest = { headers };
    return { request, result: guard.canActivate(contextFor(request)) };
  };

  // RNX-225: the login JWT is retired as an access method; a JWT signed with JWT_SECRET is no credential.
  describe("no JWT path (RNX-225)", () => {
    it.each([
      ["a valid login JWT", { authorization: `Bearer ${sign({ userId: "user-a", email: "a@test.local" })}` }],
      ["no Authorization header and no cookie", {}],
      ["an expired JWT", { authorization: `Bearer ${sign({ userId: "u", exp: Math.floor(Date.now() / 1000) - 60 })}` }],
      ["a JWT signed with another secret", { authorization: `Bearer ${sign({ userId: "u" }, "another-secret")}` }],
      ["an API key (wrong credential type)", { authorization: "Bearer rnx_live_some-api-key" }],
      ["a garbage token", { authorization: "Bearer not.a.jwt" }],
    ])("401 with %s", async (_case, headers: Record<string, string>) => {
      const { request, result } = run(headers);

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
      // Without a cookie header the Better Auth session is never consulted.
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("is built without JWT_SECRET (it reads no JWT any more)", () => {
      const savedSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        expect(() => new CombinedAuthGuard()).not.toThrow();
      } finally {
        process.env.JWT_SECRET = savedSecret;
      }
    });
  });

  describe("Better Auth session path (cookie)", () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      user: { id: "user-s", email: "s@test.local" },
      session: { id: "session-1", expiresAt: new Date(Date.now() + 60_000) },
      ...overrides,
    });

    it("valid session: allowed, req.user = { userId, email } from the session; headers are passed on", async () => {
      mockGetSession.mockResolvedValue(session());
      const { request, result } = run({ cookie: "better-auth.session_token=abc" });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: "user-s", email: "s@test.local" });
      const [{ headers }] = mockGetSession.mock.calls[0];
      expect((headers as Headers).get("cookie")).toBe("better-auth.session_token=abc");
    });

    it.each([
      ["getSession returns null (expired or unknown session)", null],
      ["getSession returns a session without user", { session: { id: "s" } }],
    ])("401 when %s", async (_case, value) => {
      mockGetSession.mockResolvedValue(value);
      const { request, result } = run({ cookie: "better-auth.session_token=abc" });

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
    });

    it("401 when getSession throws", async () => {
      mockGetSession.mockRejectedValue(new Error("db down"));
      const { result } = run({ cookie: "better-auth.session_token=abc" });

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // Not a hole: the guard does not read expiresAt itself, it trusts what
    // getSession returns. Better Auth's getSession returns null for an expired session.
    it("a session object whose expiresAt is in the past is still accepted (expiry is Better Auth's job)", async () => {
      mockGetSession.mockResolvedValue(
        session({ session: { id: "old", expiresAt: new Date(Date.now() - 60_000) } }),
      );
      const { request, result } = run({ cookie: "better-auth.session_token=old" });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: "user-s", email: "s@test.local" });
    });

    it("a login JWT next to the cookie: the cookie session decides, the JWT is ignored", async () => {
      mockGetSession.mockResolvedValue(session());
      const { request, result } = run({
        authorization: `Bearer ${sign({ userId: "user-a", email: "a@test.local" })}`,
        cookie: "better-auth.session_token=abc",
      });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: "user-s", email: "s@test.local" });
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });
  });
});
