import { Controller, Get, Req } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { Access } from "../decorators/access.decorator";
import { AdminSessionService } from "../../app/admin-auth/service/admin-session.service";
import { PrismaService } from "../../app/prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";
import { seedAdminRoles } from "../../../test/admin-auth";

// RX-94: the `staff` method of the global AccessGuard, its scope option and `reauth`, through real HTTP
// (Fastify `inject`) with the real session check on the test database. Sessions are started with
// AdminSessionService directly; sign-in itself is tested in admin-auth.controller.spec.ts.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

type ProbeRequest = { admin?: unknown; user?: unknown };
const seen = (request: ProbeRequest) => ({ admin: request.admin ?? null, user: request.user ?? null });

@Controller("staff-probe")
class StaffProbeController {
  @Get("full")
  @Access({ auth: ["staff"] })
  full(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("enrolment")
  @Access({ auth: ["staff"], staffScope: "enrolment" })
  enrolment(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("any")
  @Access({ auth: ["staff"], staffScope: "any" })
  any(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("reauth")
  @Access({ auth: ["staff"], reauth: true })
  reauth(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("mixed")
  @Access({ auth: ["staff", "jwt"] })
  mixed(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("permissions")
  @Access({ auth: ["staff"], permissions: ["admins:write"] })
  permissions(@Req() request: ProbeRequest) {
    return seen(request);
  }
}

@Controller("product-probe")
class ProductProbeController {
  @Get("login")
  @Access({ auth: ["jwt", "session"] })
  login(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("api-key")
  @Access({ auth: ["apiKey"] })
  apiKey(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("reauth")
  @Access({ auth: ["jwt"], reauth: true })
  reauth(@Req() request: ProbeRequest) {
    return seen(request);
  }

  @Get("scope")
  @Access({ auth: ["jwt"], staffScope: "any" })
  scope(@Req() request: ProbeRequest) {
    return seen(request);
  }
}

const API_KEY = "sk_live_rx94-valid-key";
const BETTER_AUTH_COOKIE = "better-auth.session_token=rx94";
const ACCESS = "rx_admin_access";
const MINUTE = 60_000;
/** Only Date is faked: the database driver and Fastify keep their real timers. */
const NOT_DATE = [
  "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
  "clearInterval", "setTimeout", "clearTimeout",
] as const;

describe("AccessGuard staff method (RX-94, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let sessions: AdminSessionService;
  let user: { id: string; email: string };
  let admin: { id: string };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ controllers: [StaffProbeController, ProductProbeController] }));
    app = await createFastifyApp(moduleRef);
    sessions = moduleRef.get(AdminSessionService);
  });

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: [...NOT_DATE], now: new Date("2026-10-14T08:00:00Z") });
    await resetDatabase(prisma);
    user = await createUser(prisma, { apiKey: API_KEY });
    await seedAdminRoles(prisma);
    admin = await prisma.adminUser.create({ data: { email: "ops@example.com", passwordHash: "not-used", role: "operations" } });
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  afterEach(() => jest.useRealTimers());

  afterAll(() => app?.close());

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
  const adminCookie = async (scope: string) => {
    const session = await sessions.start(admin.id, scope, "jest");
    return { cookie: `${ACCESS}=${session.accessToken}`, sessionId: session.sessionId };
  };
  const loginJwt = () => `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`;
  const withValidBetterAuthSession = () =>
    mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });

  describe("a full staff route", () => {
    it("full session: 200, request.admin = { adminId, sessionId, scope, role }, lastSeenAt updated", async () => {
      const { cookie, sessionId } = await adminCookie("full");
      jest.setSystemTime(Date.now() + MINUTE);

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ admin: { adminId: admin.id, sessionId, scope: "full", role: "operations" }, user: null });
      const row = await prisma.adminSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(row.lastSeenAt.getTime()).toBe(Date.now());
    });

    it("enrolment session: 403 (criterion 1), nothing attached", async () => {
      const { cookie } = await adminCookie("enrolment");

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(403);
    });

    it.each([
      ["nothing", () => ({})],
      ["a garbage admin cookie", () => ({ cookie: `${ACCESS}=not.a.jwt` })],
      ["a login JWT inside the admin cookie", () => ({ cookie: `${ACCESS}=${loginJwt().slice(7)}` })],
      [
        "an admin token signed with JWT_SECRET",
        () => ({ cookie: `${ACCESS}=${jwt.sign({ sid: "x" }, process.env.JWT_SECRET!, { audience: "renovix-admin", subject: admin.id })}` }),
      ],
    ])("%s: 401", async (_case, headers) => {
      const res = await get("/staff-probe/full", headers());

      expect(res.statusCode).toBe(401);
    });

    // The next three share one live session and the admin secret, so the audience is the only difference.
    const signForLiveSession = async (options: jwt.SignOptions) => {
      const { sessionId } = await adminCookie("full");
      return `${ACCESS}=${jwt.sign({ sid: sessionId, scope: "full" }, process.env.ADMIN_JWT_SECRET!, { subject: admin.id, ...options })}`;
    };

    it("an admin token for a live session without the admin audience: 401", async () => {
      const cookie = await signForLiveSession({});

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(401);
    });

    it("an admin token for a live session with another audience: 401", async () => {
      const cookie = await signForLiveSession({ audience: "renovix-product" });

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(401);
    });

    it("an admin token for a live session with the admin audience: 200 (control)", async () => {
      const cookie = await signForLiveSession({ audience: "renovix-admin" });

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(200);
    });

    it("a revoked session: 401", async () => {
      const { cookie, sessionId } = await adminCookie("full");
      await sessions.end(sessionId);

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(401);
    });

    it("a correctly signed token for a session that does not exist: 401", async () => {
      const token = jwt.sign({ sid: "00000000-0000-4000-8000-000000000000", scope: "full" }, process.env.ADMIN_JWT_SECRET!, {
        audience: "renovix-admin",
        subject: admin.id,
      });

      const res = await get("/staff-probe/full", { cookie: `${ACCESS}=${token}` });

      expect(res.statusCode).toBe(401);
    });

    it("a token whose admin is not the session's admin: 401", async () => {
      const { sessionId } = await adminCookie("full");
      const forged = jwt.sign({ sid: sessionId, scope: "full" }, process.env.ADMIN_JWT_SECRET!, {
        audience: "renovix-admin",
        subject: "another-admin",
      });

      const res = await get("/staff-probe/full", { cookie: `${ACCESS}=${forged}` });

      expect(res.statusCode).toBe(401);
    });

    it("an access token older than 15 minutes: 401", async () => {
      const { cookie } = await adminCookie("full");
      jest.setSystemTime(Date.now() + 16 * MINUTE);

      const res = await get("/staff-probe/full", { cookie });

      expect(res.statusCode).toBe(401);
    });
  });

  // M3: a staff route never probes product credentials. No valid admin session is 401 whatever else the
  // request carries, so a back-office frontend that refreshes on 401 also refreshes in a browser signed
  // into the product.
  describe("product credentials on a staff route (criterion 4): refused with 401", () => {
    it("a valid login JWT: 401, nothing attached", async () => {
      const res = await get("/staff-probe/full", { authorization: loginJwt() });

      expect(res.statusCode).toBe(401);
      expect(res.json().user).toBeUndefined();
    });

    it("a valid API key: 401", async () => {
      const res = await get("/staff-probe/full", { authorization: `Bearer ${API_KEY}` });

      expect(res.statusCode).toBe(401);
    });

    it("a valid better-auth session cookie: 401", async () => {
      withValidBetterAuthSession();

      const res = await get("/staff-probe/full", { cookie: BETTER_AUTH_COOKIE });

      expect(res.statusCode).toBe(401);
    });

    it("a valid login JWT plus an expired admin access cookie: 401 (the frontend refreshes)", async () => {
      const { cookie } = await adminCookie("full");
      jest.setSystemTime(Date.now() + 16 * MINUTE);

      const res = await get("/staff-probe/full", { cookie, authorization: loginJwt() });

      expect(res.statusCode).toBe(401);
    });

    it("an unknown API key, a cookie without a session: 401", async () => {
      const withKey = await get("/staff-probe/full", { authorization: "Bearer sk_live_unknown" });
      const withCookie = await get("/staff-probe/full", { cookie: BETTER_AUTH_COOKIE });

      expect(withKey.statusCode).toBe(401);
      expect(withCookie.statusCode).toBe(401);
    });
  });

  describe("an admin session on a product route: never accepted", () => {
    it.each(["/product-probe/login", "/product-probe/api-key"])("%s: 401 with only the admin cookie", async (url) => {
      const { cookie } = await adminCookie("full");

      const res = await get(url, { cookie });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("staff scopes", () => {
    it("an enrolment route: enrolment session 200, full session 403", async () => {
      const enrolment = await adminCookie("enrolment");
      const full = await adminCookie("full");

      expect((await get("/staff-probe/enrolment", { cookie: enrolment.cookie })).statusCode).toBe(200);
      expect((await get("/staff-probe/enrolment", { cookie: full.cookie })).statusCode).toBe(403);
    });

    it("an any-scope route: both 200, nothing 401", async () => {
      const enrolment = await adminCookie("enrolment");
      const full = await adminCookie("full");

      expect((await get("/staff-probe/any", { cookie: enrolment.cookie })).statusCode).toBe(200);
      expect((await get("/staff-probe/any", { cookie: full.cookie })).statusCode).toBe(200);
      expect((await get("/staff-probe/any")).statusCode).toBe(401);
    });
  });

  describe("reauth: true", () => {
    it("never re-authenticated: 403 with a full session", async () => {
      const { cookie } = await adminCookie("full");

      const res = await get("/staff-probe/reauth", { cookie });

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("Re-authentication required");
    });

    it("re-authenticated: 200 for 5 minutes, 403 after", async () => {
      const { cookie, sessionId } = await adminCookie("full");
      await sessions.markReauth(sessionId);
      jest.setSystemTime(Date.now() + 5 * MINUTE);
      const within = await get("/staff-probe/reauth", { cookie });
      jest.setSystemTime(Date.now() + MINUTE);

      const after = await get("/staff-probe/reauth", { cookie });

      expect(within.statusCode).toBe(200);
      expect(after.statusCode).toBe(403);
    });

    it("an enrolment session that re-authenticated: still 403 (full sessions only)", async () => {
      const { cookie, sessionId } = await adminCookie("enrolment");
      await sessions.markReauth(sessionId);

      expect((await get("/staff-probe/reauth", { cookie })).statusCode).toBe(403);
    });
  });

  describe("declarations the guard refuses", () => {
    it.each([
      ["a full admin session", async () => ({ cookie: (await adminCookie("full")).cookie })],
      ["a valid login JWT", async () => ({ authorization: loginJwt() })],
      ["nothing", async () => ({})],
    ])("staff next to another method: 403 with %s", async (_case, headers) => {
      const res = await get("/staff-probe/mixed", await headers());

      expect(res.statusCode).toBe(403);
    });

    it("staff with permissions (RX-96): 403 with a full admin session", async () => {
      const { cookie } = await adminCookie("full");

      expect((await get("/staff-probe/permissions", { cookie })).statusCode).toBe(403);
    });

    it.each(["/product-probe/reauth", "/product-probe/scope"])("%s without staff: 403 with a valid login JWT", async (url) => {
      const res = await get(url, { authorization: loginJwt() });

      expect(res.statusCode).toBe(403);
    });
  });
});
