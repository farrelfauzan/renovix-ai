import { Controller, HttpCode, Post } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../admin-auth.module";
import { PrismaService } from "../../prisma/prisma.service";
import { Access } from "../../../common/decorators/access.decorator";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  accessCookie,
  ADMIN_PASSWORD,
  advance,
  BACK_OFFICE_ORIGIN,
  BackOfficeProbeController,
  createAdmin,
  MINUTE,
  refreshCookie,
  setCookies,
  totpCode,
  useFakeDate,
  WRONG_PASSWORD,
} from "../../../../test/admin-auth";

// RX-156 (D117 item 73): every /admin route answers only the back-office's own origin (ADMIN_ORIGIN).
// Real HTTP (Fastify `inject`), the global guards of createTestModule, the test database.
const PRODUCT_ORIGIN = "https://chat.renovix.id";
/** Production mode needs a real-length JWT_SECRET (RX-110) and CORS_ORIGIN (RNX-70), so these rows fail on ADMIN_ORIGIN only. */
const PRODUCTION = {
  NODE_ENV: "production",
  JWT_SECRET: "rx156-production-mode-jwt-secret-".padEnd(64, "x"),
  CORS_ORIGIN: PRODUCT_ORIGIN,
};
const FOREIGN_ORIGINS = [PRODUCT_ORIGIN, "https://evil.example", "null", "http://admin.renovix.test.evil.example"];

@Controller("product-origin-probe")
class ProductOriginProbeController {
  @Post()
  @HttpCode(200)
  @Access({ public: true, reason: "test-only product route (RX-156): the origin check is for /admin routes only" })
  probe() {
    return { ok: true };
  }
}

/** Starts the module with these environment values (undefined: unset), restored afterwards. */
async function startWith(env: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.entries(env).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
  try {
    const { moduleRef, prisma } = await createTestModule({
      imports: [AdminAuthModule],
      controllers: [BackOfficeProbeController, ProductOriginProbeController],
    });
    return { moduleRef, prisma, app: await createFastifyApp(moduleRef) };
  } finally {
    Object.entries(saved).forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value)));
  }
}

describe("Back-office origin check (RX-156, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma, app } = await startWith({}));
  });

  beforeEach(async () => {
    useFakeDate();
    await resetDatabase(prisma);
  });

  afterEach(() => jest.useRealTimers());

  afterAll(() => app?.close());

  const enrolledAdmin = () => createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
  const signIn = (headers: Record<string, string>, body: object) =>
    app.inject({ method: "POST", url: "/admin/auth/sign-in", headers, payload: body });
  /** A full session through the back-office origin; returns its cookies and row id. */
  const signedIn = async () => {
    const admin = await enrolledAdmin();
    const res = await signIn(BACK_OFFICE_ORIGIN, { email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    expect(res.statusCode).toBe(200);
    const session = await prisma.adminSession.findFirstOrThrow();
    return { admin, access: accessCookie(res), refresh: refreshCookie(res), session };
  };

  describe("criterion 1: a product app's or any other foreign Origin → 403, nothing done", () => {
    it.each(FOREIGN_ORIGINS)("sign-in with valid credentials, Origin %s: 403, no cookie, no session", async (origin) => {
      const admin = await enrolledAdmin();

      const res = await signIn({ origin }, { email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect(res.statusCode).toBe(403);
      expect(setCookies(res)).toEqual([]);
      expect(await prisma.adminSession.count()).toBe(0);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).lastAcceptedTimeStep).toBeNull();
    });

    it("a wrong password with a foreign Origin: 403 and the failed attempt is not counted", async () => {
      const admin = await enrolledAdmin();

      const res = await signIn({ origin: PRODUCT_ORIGIN }, { email: admin.email, password: WRONG_PASSWORD, totp: "123456" });

      expect(res.statusCode).toBe(403);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).failedAttempts).toBe(0);
    });

    it("another /admin controller (GET /admin/probe) with a valid session and a foreign Origin: 403, the session is not touched", async () => {
      const { access, session } = await signedIn();
      advance(MINUTE);

      const res = await app.inject({ method: "GET", url: "/admin/probe", headers: { origin: PRODUCT_ORIGIN, cookie: access } });

      expect(res.statusCode).toBe(403);
      expect((await prisma.adminSession.findUniqueOrThrow({ where: { id: session.id } })).lastSeenAt).toEqual(session.lastSeenAt);
    });

    it("DELETE /admin/auth/sessions/:id with a valid session and a foreign Origin: 403, the session is not revoked", async () => {
      const { access, session } = await signedIn();

      const res = await app.inject({ method: "DELETE", url: `/admin/auth/sessions/${session.id}`, headers: { origin: "https://evil.example", cookie: access } });

      expect(res.statusCode).toBe(403);
      expect((await prisma.adminSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    });
  });

  describe("criterion 2: a state-changing /admin request without Origin → 403, nothing done", () => {
    it("POST sign-in with valid credentials and no Origin: 403, no cookie, no session", async () => {
      const admin = await enrolledAdmin();

      const res = await signIn({}, { email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect(res.statusCode).toBe(403);
      expect(setCookies(res)).toEqual([]);
      expect(await prisma.adminSession.count()).toBe(0);
    });

    it("POST refresh with a valid refresh cookie and no Origin: 403, the refresh token is not rotated", async () => {
      const { refresh, session } = await signedIn();

      const res = await app.inject({ method: "POST", url: "/admin/auth/refresh", headers: { cookie: refresh } });

      expect(res.statusCode).toBe(403);
      expect((await prisma.adminSession.findUniqueOrThrow({ where: { id: session.id } })).refreshTokenHash).toBe(session.refreshTokenHash);
    });

    it("POST sign-out and DELETE a session with a valid session and no Origin: 403, the session is not ended", async () => {
      const { access, session } = await signedIn();

      const signOut = await app.inject({ method: "POST", url: "/admin/auth/sign-out", headers: { cookie: access } });
      const revoke = await app.inject({ method: "DELETE", url: `/admin/auth/sessions/${session.id}`, headers: { cookie: access } });

      expect([signOut.statusCode, revoke.statusCode]).toEqual([403, 403]);
      expect((await prisma.adminSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    });

    it("GET without Origin is allowed: GET /admin/probe and /admin/auth/sessions with a valid session answer 200", async () => {
      const { access } = await signedIn();

      const probe = await app.inject({ method: "GET", url: "/admin/probe", headers: { cookie: access } });
      const sessions = await app.inject({ method: "GET", url: "/admin/auth/sessions", headers: { cookie: access } });

      expect([probe.statusCode, sessions.statusCode]).toEqual([200, 200]);
    });
  });

  describe("criterion 3: the back-office Origin → the request proceeds as before", () => {
    it("sign-in, sessions, sign-out: 200, 200, 204", async () => {
      const { access, session } = await signedIn();

      const sessions = await app.inject({ method: "GET", url: "/admin/auth/sessions", headers: { ...BACK_OFFICE_ORIGIN, cookie: access } });
      const signOut = await app.inject({ method: "POST", url: "/admin/auth/sign-out", headers: { ...BACK_OFFICE_ORIGIN, cookie: access } });

      expect([sessions.statusCode, signOut.statusCode]).toEqual([200, 204]);
      expect((await prisma.adminSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    });

    it("a product route is not affected: a foreign Origin or none answers 200", async () => {
      const foreign = await app.inject({ method: "POST", url: "/product-origin-probe", headers: { origin: "https://evil.example" } });
      const none = await app.inject({ method: "POST", url: "/product-origin-probe" });

      expect([foreign.statusCode, none.statusCode]).toEqual([200, 200]);
    });
  });

  describe("criterion 4: ADMIN_ORIGIN has no fallback, the API does not start without it", () => {
    it.each([
      [{ ...PRODUCTION, ADMIN_ORIGIN: undefined }, "ADMIN_ORIGIN is required"],
      [{ ...PRODUCTION, ADMIN_ORIGIN: "" }, "ADMIN_ORIGIN is required"],
      [{ NODE_ENV: "development", ADMIN_ORIGIN: undefined }, "ADMIN_ORIGIN is required"],
      [{ ADMIN_ORIGIN: "https://admin.renovix.test/" }, "ADMIN_ORIGIN must be an origin"],
      [{ ADMIN_ORIGIN: "https://admin.renovix.test,https://chat.renovix.id" }, "ADMIN_ORIGIN must be an origin"],
    ])("%o: the module refuses to start", async (env, message) => {
      await expect(startWith(env)).rejects.toThrow(message);
    });
  });
});
