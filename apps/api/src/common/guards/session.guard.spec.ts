import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { SessionGuard } from "./session.guard";

// RX-15 characterization: SessionGuard as it behaves today. No route uses it
// (every @UseGuards names CombinedAuthGuard, ApiKeyGuard or PortalGuard).
// better-auth is ESM-only; its session lookup is a mock the tests program.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

type TestRequest = { headers: Record<string, string>; user?: unknown };
const contextFor = (request: TestRequest) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe("SessionGuard (RX-15 characterization)", () => {
  const guard = new SessionGuard();

  beforeEach(() => mockGetSession.mockReset());

  const run = (headers: Record<string, string>) => {
    const request: TestRequest = { headers };
    return { request, result: guard.canActivate(contextFor(request)) };
  };

  it("valid session: allowed, req.user = { userId, email, sessionId }; request headers are passed on", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-s", email: "s@test.local" },
      session: { id: "session-1", expiresAt: new Date(Date.now() + 60_000) },
    });
    const { request, result } = run({ cookie: "better-auth.session_token=abc" });

    await expect(result).resolves.toBe(true);
    expect(request.user).toEqual({ userId: "user-s", email: "s@test.local", sessionId: "session-1" });
    const [{ headers }] = mockGetSession.mock.calls[0];
    expect((headers as Headers).get("cookie")).toBe("better-auth.session_token=abc");
  });

  it.each([
    ["getSession returns null (missing, unknown or expired session)", null],
    ["getSession returns a session without user", { session: { id: "s" } }],
  ])("401 when %s", async (_case, value) => {
    mockGetSession.mockResolvedValue(value);
    const { request, result } = run({ cookie: "better-auth.session_token=abc" });

    await expect(result).rejects.toBeInstanceOf(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });

  it("401 when getSession throws", async () => {
    mockGetSession.mockRejectedValue(new Error("db down"));

    await expect(run({ cookie: "x=y" }).result).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("asks getSession even with no headers at all (401 when it returns null)", async () => {
    mockGetSession.mockResolvedValue(null);

    await expect(run({}).result).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  it("a JWT or API key in Authorization is not a credential here (wrong type): only getSession decides", async () => {
    mockGetSession.mockResolvedValue(null);
    const token = jwt.sign({ userId: "u", email: "u@test.local" }, "any-secret");

    await expect(run({ authorization: `Bearer ${token}` }).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(run({ authorization: "Bearer sk_live_key" }).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // Not a hole: the guard does not read expiresAt itself, it trusts what
  // getSession returns. Better Auth's getSession returns null for an expired session.
  it("a session object whose expiresAt is in the past is still accepted (expiry is Better Auth's job)", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-s", email: "s@test.local" },
      session: { id: "old", expiresAt: new Date(Date.now() - 60_000) },
    });

    await expect(run({ cookie: "better-auth.session_token=old" }).result).resolves.toBe(true);
  });
});
