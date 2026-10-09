import { BadRequestException, ExecutionContext } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { PortalGuard, PortalIdentity } from "./portal.guard";
import { PrismaService } from "../prisma/prisma.service";
import { createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";

// RX-15 characterization: PortalGuard as it behaves today (test database for
// the user lookup). better-auth is ESM-only; its session lookup is a mock.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const SECRET = "rx15-portal-jwt";
const SESSION = "11111111-1111-4111-8111-111111111111";

type TestRequest = { headers: Record<string, string>; portalIdentity?: PortalIdentity };
const contextFor = (request: TestRequest) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe("PortalGuard (RX-15 characterization, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let guard: PortalGuard;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [JwtModule.register({ secret: SECRET })],
      providers: [PortalGuard],
    }));
    guard = moduleRef.get(PortalGuard);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  afterAll(() => moduleRef?.close());

  const token = (userId: string, options: jwt.SignOptions = {}) =>
    moduleRef.get(JwtService).sign({ userId, email: "x@test.local" }, options);

  const identityFor = async (headers: Record<string, string>) => {
    const request: TestRequest = { headers };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    return request.portalIdentity!;
  };

  it("400 without X-Portal-Session, even with a valid JWT", async () => {
    const user = await createUser(prisma, { balance: 5 });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: `Bearer ${token(user.id)}` } })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("session header only: allowed as anonymous free tier (the guard never answers 401)", async () => {
    expect(await identityFor({ "x-portal-session": SESSION })).toEqual({
      sessionId: SESSION,
      tier: "free",
      user: undefined,
    });
  });

  it("valid JWT, user with balance: paid tier with the user from the database", async () => {
    const user = await createUser(prisma, { balance: 5 });

    expect(
      await identityFor({ "x-portal-session": SESSION, authorization: `Bearer ${token(user.id)}` }),
    ).toEqual({
      sessionId: SESSION,
      tier: "paid",
      user: { id: user.id, email: user.email, balance: 5 },
    });
  });

  it("valid JWT, user with zero balance: free tier but signed in", async () => {
    const user = await createUser(prisma);

    const identity = await identityFor({
      "x-portal-session": SESSION,
      authorization: `Bearer ${token(user.id)}`,
    });
    expect(identity.tier).toBe("free");
    expect(identity.user).toEqual({ id: user.id, email: user.email, balance: 0 });
  });

  it.each([
    ["an expired JWT", (id: string) => `Bearer ${token(id, { expiresIn: -60 })}`],
    ["a JWT signed with another secret", (id: string) => `Bearer ${jwt.sign({ userId: id }, "another-secret")}`],
    ["a malformed token", () => "Bearer not.a.jwt"],
    ["a Basic scheme", () => "Basic abc"],
  ])("%s: treated as anonymous (no user), not rejected", async (_case, header: (id: string) => string) => {
    const user = await createUser(prisma, { balance: 5 });

    const identity = await identityFor({ "x-portal-session": SESSION, authorization: header(user.id) });
    expect(identity).toEqual({ sessionId: SESSION, tier: "free", user: undefined });
  });

  it("an API key (wrong credential type) is skipped: anonymous, even when it is the user's real key", async () => {
    await createUser(prisma, { balance: 5, apiKey: "sk_live_portal-key" });

    const identity = await identityFor({
      "x-portal-session": SESSION,
      authorization: "Bearer sk_live_portal-key",
    });
    expect(identity.user).toBeUndefined();
  });

  it("a valid JWT for a user that is not in the database: anonymous", async () => {
    const identity = await identityFor({
      "x-portal-session": SESSION,
      authorization: `Bearer ${token("00000000-0000-4000-8000-000000000000")}`,
    });
    expect(identity.user).toBeUndefined();
  });

  describe("Better Auth cookie session", () => {
    it("a session whose user exists: signed in (paid with balance)", async () => {
      const user = await createUser(prisma, { balance: 2 });
      mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });

      const identity = await identityFor({ "x-portal-session": SESSION, cookie: "better-auth.session_token=abc" });
      expect(identity).toEqual({
        sessionId: SESSION,
        tier: "paid",
        user: { id: user.id, email: user.email, balance: 2 },
      });
    });

    it.each([
      ["getSession returns null (expired or unknown session)", async () => null],
      ["getSession throws", async () => Promise.reject(new Error("db down"))],
      ["the session's user is not in the database", async () => ({ user: { id: "00000000-0000-4000-8000-000000000000", email: "gone@test.local" } })],
    ])("%s: anonymous", async (_case, impl: () => Promise<unknown>) => {
      mockGetSession.mockImplementation(impl);

      const identity = await identityFor({ "x-portal-session": SESSION, cookie: "better-auth.session_token=abc" });
      expect(identity.user).toBeUndefined();
    });

    it("an invalid JWT falls through to the cookie session", async () => {
      const user = await createUser(prisma, { balance: 2 });
      mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });

      const identity = await identityFor({
        "x-portal-session": SESSION,
        authorization: `Bearer ${jwt.sign({ userId: "u" }, "another-secret")}`,
        cookie: "better-auth.session_token=abc",
      });
      expect(identity.user?.id).toBe(user.id);
    });

    it("a valid JWT wins over the cookie session (getSession not called)", async () => {
      const jwtUser = await createUser(prisma, { balance: 1 });
      const cookieUser = await createUser(prisma, { balance: 1 });
      mockGetSession.mockResolvedValue({ user: { id: cookieUser.id, email: cookieUser.email } });

      const identity = await identityFor({
        "x-portal-session": SESSION,
        authorization: `Bearer ${token(jwtUser.id)}`,
        cookie: "better-auth.session_token=abc",
      });
      expect(identity.user?.id).toBe(jwtUser.id);
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });
});
