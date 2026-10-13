import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { CombinedAuthGuard } from "./combined-auth.guard";

// RX-15 characterization: CombinedAuthGuard as it behaves today (no database).
// better-auth is ESM-only; its session lookup is a mock the tests program.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const SECRET = "rx15-test-jwt-secret";

type TestRequest = { headers: Record<string, string>; user?: unknown };
const contextFor = (request: TestRequest) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const sign = (payload: object, secret = SECRET, options: jwt.SignOptions = {}) =>
  jwt.sign(payload, secret, options);

describe("CombinedAuthGuard (RX-15 characterization)", () => {
  let guard: CombinedAuthGuard;
  const savedSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = SECRET; // read once, in the constructor
    guard = new CombinedAuthGuard();
  });

  afterAll(() => {
    if (savedSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedSecret;
  });

  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  const run = (headers: Record<string, string>) => {
    const request: TestRequest = { headers };
    return { request, result: guard.canActivate(contextFor(request)) };
  };

  describe("JWT path", () => {
    it("valid JWT: allowed, req.user = { userId, email } from the token", async () => {
      const token = sign({ userId: "user-a", email: "a@test.local" });
      const { request, result } = run({ authorization: `Bearer ${token}` });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: "user-a", email: "a@test.local" });
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("valid JWT for a user id that does not exist: still allowed (no database lookup in the guard)", async () => {
      const token = sign({ userId: "00000000-0000-4000-8000-000000000000", email: "gone@test.local" });
      const { request, result } = run({ authorization: `Bearer ${token}` });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({
        userId: "00000000-0000-4000-8000-000000000000",
        email: "gone@test.local",
      });
    });

    // NOTE (RX-15): the payload shape is not checked. A token signed with the
    // secret but without userId passes with userId undefined. Only the API
    // signs tokens ({ userId, email }), so this needs the secret; hardening note.
    it("signed JWT without userId: allowed with userId undefined", async () => {
      const token = sign({ sub: "someone" });
      const { request, result } = run({ authorization: `Bearer ${token}` });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: undefined, email: undefined });
    });

    it.each([
      ["no Authorization header and no cookie", {}],
      ["an expired JWT", { authorization: `Bearer ${sign({ userId: "u", exp: Math.floor(Date.now() / 1000) - 60 })}` }],
      ["a JWT signed with another secret", { authorization: `Bearer ${sign({ userId: "u" }, "another-secret")}` }],
      ["an unsigned JWT (alg none)", { authorization: `Bearer ${sign({ userId: "u" }, "", { algorithm: "none" })}` }],
      ["an API key (wrong credential type)", { authorization: "Bearer sk_live_some-api-key" }],
      ["a lowercase bearer scheme", { authorization: `bearer ${sign({ userId: "u" })}` }],
      ["a Basic scheme", { authorization: `Basic ${Buffer.from("a:b").toString("base64")}` }],
      ["Bearer with no token", { authorization: "Bearer " }],
      ["a garbage token", { authorization: "Bearer not.a.jwt" }],
    ])("401 with %s", async (_case, headers: Record<string, string>) => {
      const { request, result } = run(headers);

      await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
      expect(request.user).toBeUndefined();
      // Without a cookie header the Better Auth session is never consulted.
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("401 for every token when JWT_SECRET is unset at construction", async () => {
      delete process.env.JWT_SECRET;
      const unconfigured = new CombinedAuthGuard();
      process.env.JWT_SECRET = SECRET;
      const request: TestRequest = { headers: { authorization: `Bearer ${sign({ userId: "u" })}` } };

      await expect(unconfigured.canActivate(contextFor(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
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

    it("an invalid JWT falls through to the cookie session", async () => {
      mockGetSession.mockResolvedValue(session());
      const { request, result } = run({
        authorization: `Bearer ${sign({ userId: "u" }, "another-secret")}`,
        cookie: "better-auth.session_token=abc",
      });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: "user-s", email: "s@test.local" });
    });

    it("a valid JWT wins over a cookie session (getSession not called)", async () => {
      mockGetSession.mockResolvedValue(session());
      const { request, result } = run({
        authorization: `Bearer ${sign({ userId: "user-a", email: "a@test.local" })}`,
        cookie: "better-auth.session_token=abc",
      });

      await expect(result).resolves.toBe(true);
      expect(request.user).toEqual({ userId: "user-a", email: "a@test.local" });
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });
});
