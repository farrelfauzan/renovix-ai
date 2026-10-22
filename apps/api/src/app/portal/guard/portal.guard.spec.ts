import { ExecutionContext } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { Prisma } from "@generated/prisma/client.js";
import { PortalGuard, PortalIdentity } from "./portal.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";
import { CreditService } from "../../billing/service/credit.service";

// RX-15 characterization, RNX-225: PortalGuard (test database for the user lookup). The portal session is the
// `portal_session` cookie, else the X-Portal-Session header, else a new one whose cookie goes on the raw response;
// the user is the Better Auth session's (a login JWT is never read). better-auth is ESM-only; its session lookup is
// a mock.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const SESSION = "11111111-1111-4111-8111-111111111111";
const COOKIE_SESSION = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BETTER_AUTH_COOKIE = "better-auth.session_token=abc";

type TestRequest = { headers: Record<string, string>; portalIdentity?: PortalIdentity };

describe("PortalGuard (RX-15 characterization, RNX-225, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let guard: PortalGuard;
  let setHeader: jest.Mock;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [CreditService] }));
    guard = moduleRef.get(PortalGuard);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    setHeader = jest.fn();
  });

  afterAll(() => moduleRef?.close());

  const contextFor = (request: TestRequest) =>
    ({
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ raw: { setHeader } }) }),
    }) as unknown as ExecutionContext;

  const identityFor = async (headers: Record<string, string>) => {
    const request: TestRequest = { headers };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    return request.portalIdentity!;
  };

  const withSessionOf = (user: { id: string; email: string }) =>
    mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });

  /** A login JWT as POST /auth/login issued them before RNX-225 (the app's JWT_SECRET). */
  const loginJwt = (userId: string) => jwt.sign({ userId, email: "x@test.local" }, process.env.JWT_SECRET!);

  describe("the portal session (RNX-225)", () => {
    it("neither cookie nor header: a new session id, and its httpOnly portal_session cookie on the raw response", async () => {
      const identity = await identityFor({});

      expect(identity.sessionId).toMatch(UUID);
      expect(identity.tier).toBe("free");
      expect(setHeader.mock.calls).toEqual([
        ["set-cookie", `portal_session=${identity.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`],
      ]);
    });

    it("two requests without a session get two different ids", async () => {
      const first = await identityFor({});
      const second = await identityFor({});

      expect(first.sessionId).not.toBe(second.sessionId);
    });

    it("the portal_session cookie: its id, no new cookie", async () => {
      const identity = await identityFor({ cookie: `other=1; portal_session=${COOKIE_SESSION}` });

      expect(identity).toEqual({ sessionId: COOKIE_SESSION, tier: "free", user: undefined });
      expect(setHeader).not.toHaveBeenCalled();
    });

    it("X-Portal-Session header only (fallback until RNX-49): its id, anonymous free tier, no new cookie", async () => {
      expect(await identityFor({ "x-portal-session": SESSION })).toEqual({ sessionId: SESSION, tier: "free", user: undefined });
      expect(setHeader).not.toHaveBeenCalled();
    });

    it("cookie and header: the cookie wins", async () => {
      const identity = await identityFor({ "x-portal-session": SESSION, cookie: `portal_session=${COOKIE_SESSION}` });

      expect(identity.sessionId).toBe(COOKIE_SESSION);
    });
  });

  describe("no login JWT (RNX-225 AC1)", () => {
    it("a valid login JWT of a funded user: anonymous free tier, no user, no session lookup", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 5);

      const identity = await identityFor({ "x-portal-session": SESSION, authorization: `Bearer ${loginJwt(user.id)}` });

      expect(identity).toEqual({ sessionId: SESSION, tier: "free", user: undefined });
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("a valid login JWT next to a Better Auth session: the session's user", async () => {
      const jwtUser = await createUser(prisma);
      const sessionUser = await createUser(prisma);
      withSessionOf(sessionUser);

      const identity = await identityFor({
        "x-portal-session": SESSION,
        authorization: `Bearer ${loginJwt(jwtUser.id)}`,
        cookie: BETTER_AUTH_COOKIE,
      });

      expect(identity.user?.id).toBe(sessionUser.id);
    });

    it("an API key (wrong credential type) is not a user: anonymous, even when it is the user's real key", async () => {
      await createApiKey(prisma, (await createUser(prisma)).id, { apiKey: testApiKey("portal-key") });

      const identity = await identityFor({ "x-portal-session": SESSION, authorization: `Bearer ${testApiKey("portal-key")}` });

      expect(identity.user).toBeUndefined();
    });
  });

  describe("Better Auth cookie session", () => {
    // RX-22 (D202-2): the tier follows the ledger's paid wallet (available = balance - held), not User.balance.
    it("a session whose user has ledger credits: paid tier with the user from the database and the available credits", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 2);
      withSessionOf(user);

      const identity = await identityFor({ "x-portal-session": SESSION, cookie: BETTER_AUTH_COOKIE });
      expect(identity).toEqual({
        sessionId: SESSION,
        tier: "paid",
        user: { id: user.id, email: user.email, balance: 2 },
      });
    });

    it("RX-22: ledger credits all held by an open reservation: free tier (available is 0)", async () => {
      const user = await createUser(prisma);
      await fundPaidWallet(prisma, user.id, 2);
      await moduleRef.get(CreditService).reserve({ userId: user.id, requestId: "req-held", amount: new Prisma.Decimal(2) });
      withSessionOf(user);

      const identity = await identityFor({ "x-portal-session": SESSION, cookie: BETTER_AUTH_COOKIE });
      expect(identity.tier).toBe("free");
      expect(identity.user?.balance).toBe(0);
    });

    it("a user with zero balance: free tier but signed in", async () => {
      const user = await createUser(prisma);
      withSessionOf(user);

      const identity = await identityFor({ "x-portal-session": SESSION, cookie: BETTER_AUTH_COOKIE });
      expect(identity.tier).toBe("free");
      expect(identity.user).toEqual({ id: user.id, email: user.email, balance: 0 });
    });

    it("the session cookie and no portal session: a new portal session for the signed-in user", async () => {
      const user = await createUser(prisma);
      withSessionOf(user);

      const identity = await identityFor({ cookie: BETTER_AUTH_COOKIE });
      expect(identity.sessionId).toMatch(UUID);
      expect(identity.user?.id).toBe(user.id);
      expect(setHeader).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["getSession returns null (expired or unknown session)", async () => null],
      ["getSession throws", async () => Promise.reject(new Error("db down"))],
      ["the session's user is not in the database", async () => ({ user: { id: "00000000-0000-4000-8000-000000000000", email: "gone@test.local" } })],
    ])("%s: anonymous", async (_case, impl: () => Promise<unknown>) => {
      mockGetSession.mockImplementation(impl);

      const identity = await identityFor({ "x-portal-session": SESSION, cookie: BETTER_AUTH_COOKIE });
      expect(identity.user).toBeUndefined();
    });
  });
});
