import { Controller, ExecutionContext, ForbiddenException, Get, Req } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { AccessGuard } from "./access.guard";
import { Access } from "../decorators/access.decorator";
import { PrismaService } from "../../app/prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../test/factories";
import { fundPaidWallet } from "../../../test/credit-funding";

// RX-114: the global AccessGuard through real HTTP (Fastify `inject`), with
// the real checks behind its methods and the test database. The routes are
// defined here, one per kind of declaration. A better-auth session cannot be
// produced in tests (the library is ESM-only): `getSession` is a mock, and
// "a valid session" is a cookie for which it returns a user.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

type ProbeRequest = { user?: unknown; portalIdentity?: unknown };
const seen = (request: ProbeRequest) => ({
  user: request.user ?? null,
  portalIdentity: request.portalIdentity ?? null,
});

@Controller("probe")
class ProbeController {
  @Get("login")
  @Access({ auth: ["session"] })
  login(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("api-key")
  @Access({ auth: ["apiKey"] })
  apiKey(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("portal")
  @Access({ auth: ["portal"] })
  portal(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("public")
  @Access({ public: true, reason: "test route" })
  open(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("undeclared")
  undeclared(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("empty")
  @Access({})
  empty(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("no-permissions")
  @Access({ auth: ["session"], permissions: [] })
  noPermissions(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("staff")
  @Access({ auth: ["session", "staff"] })
  staff(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("permissions")
  @Access({ auth: ["session"], permissions: ["codes.manage"] })
  permissions(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("plan")
  @Access({ auth: ["session"], plan: "enterprise" })
  plan(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("reauth")
  @Access({ auth: ["session"], reauth: true })
  reauth(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("webhook")
  @Access({ webhook: "gowa" })
  webhook(@Req() request: ProbeRequest) {
    return seen(request);
  }
}

@Controller("by-class")
@Access({ auth: ["apiKey"] })
class ClassLevelController {
  @Get("inherits")
  inherits(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("overrides")
  @Access({ auth: ["session"] })
  overrides(@Req() request: ProbeRequest) {
    return seen(request);
  }
}

@Controller("no-declaration")
class UndeclaredController {
  @Get()
  anything(@Req() request: ProbeRequest) {
    return seen(request);
  }
}

const SESSION = "11111111-1111-4111-8111-111111111111";
const API_KEY = testApiKey("rx114-valid-key");
const COOKIE = "better-auth.session_token=rx114";

describe("AccessGuard (RX-114, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let user: { id: string; email: string };
  let userLookups: jest.SpyInstance;
  let keyLookups: jest.SpyInstance;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ProbeController, ClassLevelController, UndeclaredController],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await createUser(prisma);
    await createApiKey(prisma, user.id, { apiKey: API_KEY });
    // RX-22 (D202-2): the portal tier reads the ledger's paid wallet, so the portal user is funded there too.
    await fundPaidWallet(prisma, user.id, 5);
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    userLookups = jest.spyOn(prisma.user, "findUnique");
    keyLookups = jest.spyOn(prisma.apiKey, "findUnique");
  });

  afterEach(() => {
    userLookups.mockRestore();
    keyLookups.mockRestore();
  });

  afterAll(() => app?.close());

  const loginJwt = (options: jwt.SignOptions = {}) =>
    `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!, options)}`;
  const withValidSession = () =>
    mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });
  /** The headers of a request with a valid session (the session lookup now answers the user). */
  const validSession = (): Record<string, string> => {
    withValidSession();
    return { cookie: COOKIE };
  };
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url, headers });

  describe("a route that accepts a session", () => {
    // RNX-225: the login JWT is retired as an access method: no credential, so 401 (was 200 on a jwt/session route).
    it("valid login JWT: 401, nothing attached, no database or session lookup", async () => {
      const res = await get("/probe/login", { authorization: loginJwt() });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Authentication required");
      expect(userLookups).toHaveBeenCalledTimes(0);
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("valid session cookie: 200, req.user = { userId, email }, one session lookup", async () => {
      withValidSession();

      const res = await get("/probe/login", { cookie: COOKIE });

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toEqual({ userId: user.id, email: user.email });
      expect(userLookups).toHaveBeenCalledTimes(0);
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });

    it("valid API key: 403 (a method this route does not accept)", async () => {
      const res = await get("/probe/login", { authorization: `Bearer ${API_KEY}` });

      expect(res.statusCode).toBe(403);
      // RNX-18: the key is looked up in api_keys (with its user), not in users
      expect(keyLookups).toHaveBeenCalledTimes(1); // only after the session failed
      expect(userLookups).toHaveBeenCalledTimes(0);
    });

    it("X-Portal-Session alone: 401 (an unverified id is not a signed-in user)", async () => {
      const res = await get("/probe/login", { "x-portal-session": SESSION });

      expect(res.statusCode).toBe(401);
    });

    it.each([
      ["nothing", {}],
      ["a garbage bearer", { authorization: "Bearer not.a.jwt" }],
      ["an expired login JWT", () => ({ authorization: loginJwt({ expiresIn: -60 }) })],
      ["a login JWT signed with another secret", { authorization: `Bearer ${jwt.sign({ userId: "u" }, "another-secret")}` }],
      ["an unknown API key", { authorization: `Bearer ${testApiKey("unknown")}` }],
      ["a cookie without a session", { cookie: COOKIE }],
    ])("%s: 401", async (_case, headers: Record<string, string> | (() => Record<string, string>)) => {
      const res = await get("/probe/login", typeof headers === "function" ? headers() : headers);

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Authentication required");
    });

    it("nothing or a garbage bearer: no database lookup", async () => {
      await get("/probe/login");
      await get("/probe/login", { authorization: "Bearer not.a.jwt" });

      expect(userLookups).toHaveBeenCalledTimes(0);
    });
  });

  describe("a route that accepts an API key", () => {
    // RNX-186: was { id, email, balance } (User.balance is gone).
    it("valid API key: 200, req.user = { id, email }, one database lookup", async () => {
      const res = await get("/probe/api-key", { authorization: `Bearer ${API_KEY}` });

      expect(res.statusCode).toBe(200);
      // RNX-232: also the key and its allowed tiers.
      expect(res.json().user).toMatchObject({ id: user.id, email: user.email, apiKeyId: expect.any(String) });
      expect(keyLookups).toHaveBeenCalledTimes(1); // RNX-18: api_keys by prefix, with its user
      expect(userLookups).toHaveBeenCalledTimes(0);
    });

    it("valid login JWT: 401 (RNX-225: no credential; was 403)", async () => {
      const res = await get("/probe/api-key", { authorization: loginJwt() });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Invalid API key format");
    });

    it("valid session cookie: 403", async () => {
      withValidSession();

      const res = await get("/probe/api-key", { cookie: COOKIE });

      expect(res.statusCode).toBe(403);
    });

    it.each([
      ["nothing", {}, "Missing or invalid Authorization header"],
      ["X-Portal-Session alone", { "x-portal-session": SESSION }, "Missing or invalid Authorization header"],
      ["a garbage bearer", { authorization: "Bearer not.a.jwt" }, "Invalid API key format"],
      ["an unknown API key", { authorization: `Bearer ${testApiKey("unknown")}` }, "Invalid API key"],
    ])("%s: 401 with the API key check's own message", async (_case, headers: Record<string, string>, message) => {
      const res = await get("/probe/api-key", headers);

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe(message);
    });
  });

  describe("a portal route", () => {
    it("X-Portal-Session alone: 200, anonymous free tier, no database lookup", async () => {
      const res = await get("/probe/portal", { "x-portal-session": SESSION });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null, portalIdentity: { sessionId: SESSION, tier: "free" } });
      expect(userLookups).toHaveBeenCalledTimes(0);
    });

    // RX-22: the guard also reads the user's paid credit account (credit_accounts); the count is of user lookups.
    it("X-Portal-Session and a valid session: 200, the user, one user lookup", async () => {
      const res = await get("/probe/portal", { "x-portal-session": SESSION, ...validSession() });

      expect(res.statusCode).toBe(200);
      expect(res.json().portalIdentity).toEqual({
        sessionId: SESSION,
        tier: "paid",
        user: { id: user.id, email: user.email, balance: 5 },
      });
      expect(userLookups).toHaveBeenCalledTimes(1);
    });

    // RNX-225 AC1: a login JWT is never read on the portal.
    it("X-Portal-Session and a valid login JWT: 200 as anonymous free tier, no user lookup", async () => {
      const res = await get("/probe/portal", { "x-portal-session": SESSION, authorization: loginJwt() });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null, portalIdentity: { sessionId: SESSION, tier: "free" } });
      expect(userLookups).toHaveBeenCalledTimes(0);
    });

    it("X-Portal-Session and an API key bearer: 200 as anonymous free tier (as before RX-114)", async () => {
      const res = await get("/probe/portal", { "x-portal-session": SESSION, authorization: `Bearer ${API_KEY}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null, portalIdentity: { sessionId: SESSION, tier: "free" } });
    });

    // RNX-225: a request without a portal session gets a new one and its httpOnly cookie (was 401).
    it("no portal session: 200, a new session id and its portal_session cookie", async () => {
      const res = await get("/probe/portal");

      expect(res.statusCode).toBe(200);
      const sessionId = res.json().portalIdentity.sessionId;
      expect(res.json()).toEqual({ user: null, portalIdentity: { sessionId, tier: "free" } });
      expect(res.headers["set-cookie"]).toBe(`portal_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    });

    it("the portal_session cookie: 200 with its id, no new cookie", async () => {
      const res = await get("/probe/portal", { cookie: `portal_session=${SESSION}` });

      expect(res.json().portalIdentity).toEqual({ sessionId: SESSION, tier: "free" });
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it.each([
      ["a valid login JWT", () => ({ authorization: loginJwt() })],
      ["a valid API key", () => ({ authorization: `Bearer ${API_KEY}` })],
    ])("no portal session but %s: 200 as anonymous free tier, with a new portal session", async (_case, headers) => {
      const res = await get("/probe/portal", headers());

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toBeNull();
      expect(res.json().portalIdentity.tier).toBe("free");
      expect(res.headers["set-cookie"]).toMatch(/^portal_session=/);
    });
  });

  describe("deny by default", () => {
    const credentials: [string, () => Record<string, string>][] = [
      ["nothing", () => ({})],
      ["a valid session", () => validSession()],
      ["a valid API key", () => ({ authorization: `Bearer ${API_KEY}` })],
      ["X-Portal-Session", () => ({ "x-portal-session": SESSION })],
    ];

    it.each(credentials)("a route without @Access, called with %s: 403", async (_case, headers) => {
      const res = await get("/probe/undeclared", headers());

      expect(res.statusCode).toBe(403);
    });

    it.each(credentials)("a controller without @Access, called with %s: 403", async (_case, headers) => {
      const res = await get("/no-declaration", headers());

      expect(res.statusCode).toBe(403);
    });

    it("@Access({}) accepts no method: 403 with a valid session", async () => {
      const res = await get("/probe/empty", validSession());

      expect(res.statusCode).toBe(403);
    });

    it.each(["staff", "permissions", "plan", "reauth", "webhook"])(
      "a route that declares %s (nothing checks it yet): 403, with a valid session and with nothing",
      async (route) => {
        const signedIn = await get(`/probe/${route}`, validSession());
        const anonymous = await get(`/probe/${route}`);

        expect(signedIn.statusCode).toBe(403);
        expect(anonymous.statusCode).toBe(403);
      },
    );

    it("permissions: [] is the default (none needed): 200 with a valid session", async () => {
      const res = await get("/probe/no-permissions", validSession());

      expect(res.statusCode).toBe(200);
    });
  });

  describe("a public route", () => {
    it.each([
      ["nothing", {}],
      ["a garbage bearer", { authorization: "Bearer not.a.jwt" }],
    ])("called with %s: 200, nothing attached, no lookup", async (_case, headers: Record<string, string>) => {
      const res = await get("/probe/public", headers);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null, portalIdentity: null });
      expect(userLookups).toHaveBeenCalledTimes(0);
    });
  });

  describe("a declaration on the controller and one on the handler", () => {
    it("a handler without its own takes the controller's (API key 200, session 403)", async () => {
      const withKey = await get("/by-class/inherits", { authorization: `Bearer ${API_KEY}` });
      const withSession = await get("/by-class/inherits", validSession());

      expect(withKey.statusCode).toBe(200);
      expect(withSession.statusCode).toBe(403);
    });

    it("the handler's declaration replaces the controller's (session 200, API key 403)", async () => {
      const withKey = await get("/by-class/overrides", { authorization: `Bearer ${API_KEY}` });
      const withSession = await get("/by-class/overrides", validSession());

      expect(withSession.statusCode).toBe(200);
      expect(withKey.statusCode).toBe(403);
    });
  });

  it("a refused request keeps nothing of the credential that was not accepted (req.user is cleared)", async () => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: `Bearer ${API_KEY}` },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ProbeController.prototype.login,
      getClass: () => ProbeController,
    } as unknown as ExecutionContext;

    await expect(moduleRef.get(AccessGuard).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.user).toBeUndefined();
  });
});
