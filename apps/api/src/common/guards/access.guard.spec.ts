import { Controller, ExecutionContext, ForbiddenException, Get, Req } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { AccessGuard } from "./access.guard";
import { Access } from "../decorators/access.decorator";
import { PrismaService } from "../../app/prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";
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
  @Access({ auth: ["jwt", "session"] })
  login(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("jwt-only")
  @Access({ auth: ["jwt"] })
  jwtOnly(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("session-only")
  @Access({ auth: ["session"] })
  sessionOnly(@Req() request: ProbeRequest) {
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
  @Access({ auth: ["jwt"], permissions: [] })
  noPermissions(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("staff")
  @Access({ auth: ["jwt", "staff"] })
  staff(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("permissions")
  @Access({ auth: ["jwt"], permissions: ["codes.manage"] })
  permissions(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("plan")
  @Access({ auth: ["jwt"], plan: "enterprise" })
  plan(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("reauth")
  @Access({ auth: ["jwt"], reauth: true })
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
  @Access({ auth: ["jwt"] })
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
const API_KEY = "sk_live_rx114-valid-key";
const COOKIE = "better-auth.session_token=rx114";

describe("AccessGuard (RX-114, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let user: { id: string; email: string };
  let userLookups: jest.SpyInstance;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [ProbeController, ClassLevelController, UndeclaredController],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    user = await createUser(prisma, { apiKey: API_KEY, balance: 5 });
    // RX-22 (D202-2): the portal tier reads the ledger's paid wallet, so the portal user is funded there too.
    await fundPaidWallet(prisma, user.id, 5);
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
    userLookups = jest.spyOn(prisma.user, "findUnique");
  });

  afterEach(() => userLookups.mockRestore());

  afterAll(() => app?.close());

  const loginJwt = (options: jwt.SignOptions = {}) =>
    `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!, options)}`;
  const withValidSession = () =>
    mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url, headers });

  describe("a route that accepts jwt and session", () => {
    it("valid login JWT: 200, req.user = { userId, email }, no database lookup", async () => {
      const res = await get("/probe/login", { authorization: loginJwt() });

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toEqual({ userId: user.id, email: user.email });
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
      expect(userLookups).toHaveBeenCalledTimes(1); // only after jwt and session failed
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
      ["an unknown API key", { authorization: "Bearer sk_live_unknown" }],
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

  describe("a route that lists only one of jwt and session", () => {
    it("jwt only: a valid login JWT is 200, a valid session is 403", async () => {
      const withJwt = await get("/probe/jwt-only", { authorization: loginJwt() });
      withValidSession();
      const withSession = await get("/probe/jwt-only", { cookie: COOKIE });

      expect(withJwt.statusCode).toBe(200);
      expect(withSession.statusCode).toBe(403);
    });

    it("session only: a valid session is 200, a valid login JWT is 403", async () => {
      const withJwt = await get("/probe/session-only", { authorization: loginJwt() });
      withValidSession();
      const withSession = await get("/probe/session-only", { cookie: COOKIE });

      expect(withSession.statusCode).toBe(200);
      expect(withJwt.statusCode).toBe(403);
    });
  });

  describe("a route that accepts an API key", () => {
    it("valid API key: 200, req.user = { id, email, balance }, one database lookup", async () => {
      const res = await get("/probe/api-key", { authorization: `Bearer ${API_KEY}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({ id: user.id, email: user.email });
      expect(res.json().user).toHaveProperty("balance");
      expect(userLookups).toHaveBeenCalledTimes(1);
    });

    it("valid login JWT: 403", async () => {
      const res = await get("/probe/api-key", { authorization: loginJwt() });

      expect(res.statusCode).toBe(403);
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
      ["an unknown API key", { authorization: "Bearer sk_live_unknown" }, "Invalid API key"],
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

    it("X-Portal-Session and a valid login JWT: 200, the user, one database lookup", async () => {
      const res = await get("/probe/portal", { "x-portal-session": SESSION, authorization: loginJwt() });

      expect(res.statusCode).toBe(200);
      expect(res.json().portalIdentity).toEqual({
        sessionId: SESSION,
        tier: "paid",
        user: { id: user.id, email: user.email, balance: 5 },
      });
      expect(userLookups).toHaveBeenCalledTimes(1);
    });

    it("X-Portal-Session and an API key bearer: 200 as anonymous free tier (as before RX-114)", async () => {
      const res = await get("/probe/portal", { "x-portal-session": SESSION, authorization: `Bearer ${API_KEY}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ user: null, portalIdentity: { sessionId: SESSION, tier: "free" } });
    });

    it("no X-Portal-Session: 401 (was 400)", async () => {
      const res = await get("/probe/portal");

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Missing X-Portal-Session header");
    });

    it.each([
      ["a valid login JWT", () => ({ authorization: loginJwt() })],
      ["a valid API key", () => ({ authorization: `Bearer ${API_KEY}` })],
    ])("no X-Portal-Session but %s: still 401 (the header is the portal's credential)", async (_case, headers) => {
      const res = await get("/probe/portal", headers());

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Missing X-Portal-Session header");
    });
  });

  describe("deny by default", () => {
    const credentials: [string, () => Record<string, string>][] = [
      ["nothing", () => ({})],
      ["a valid login JWT", () => ({ authorization: loginJwt() })],
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

    it("@Access({}) accepts no method: 403 with a valid login JWT", async () => {
      const res = await get("/probe/empty", { authorization: loginJwt() });

      expect(res.statusCode).toBe(403);
    });

    it.each(["staff", "permissions", "plan", "reauth", "webhook"])(
      "a route that declares %s (nothing checks it yet): 403, with a valid login JWT and with nothing",
      async (route) => {
        const signedIn = await get(`/probe/${route}`, { authorization: loginJwt() });
        const anonymous = await get(`/probe/${route}`);

        expect(signedIn.statusCode).toBe(403);
        expect(anonymous.statusCode).toBe(403);
      },
    );

    it("permissions: [] is the default (none needed): 200 with a valid login JWT", async () => {
      const res = await get("/probe/no-permissions", { authorization: loginJwt() });

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
    it("a handler without its own takes the controller's (API key 200, login JWT 403)", async () => {
      const withKey = await get("/by-class/inherits", { authorization: `Bearer ${API_KEY}` });
      const withJwt = await get("/by-class/inherits", { authorization: loginJwt() });

      expect(withKey.statusCode).toBe(200);
      expect(withJwt.statusCode).toBe(403);
    });

    it("the handler's declaration replaces the controller's (login JWT 200, API key 403)", async () => {
      const withKey = await get("/by-class/overrides", { authorization: `Bearer ${API_KEY}` });
      const withJwt = await get("/by-class/overrides", { authorization: loginJwt() });

      expect(withJwt.statusCode).toBe(200);
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
