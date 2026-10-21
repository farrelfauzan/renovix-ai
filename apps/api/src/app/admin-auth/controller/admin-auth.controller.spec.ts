import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { AdminAuthModule } from "../admin-auth.module";
import { PasswordService } from "../service/password.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser, createApiKey, testApiKey } from "../../../../test/factories";
import {
  accessCookie,
  ADMIN_PASSWORD,
  adminHttp,
  BackOfficeProbeController,
  createAdmin,
  nextStep,
  refreshCookie,
  setCookies,
  totpCode,
  useFakeDate,
  WRONG_PASSWORD,
} from "../../../../test/admin-auth";

// RX-94 through real HTTP (Fastify `inject`), the real AccessGuard and PrismaService on the test database:
// criterion 1 (an enrolment session is accepted only by the enrolment routes), criterion 4 (product
// credentials refused on back-office routes), the generic error, cookies, sessions and sign-out.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const API_KEY = testApiKey("rx94-controller-key");
const GENERIC_401 = { statusCode: 401, message: "Invalid credentials", error: "Unauthorized" };

describe("AdminAuthController (RX-94, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof adminHttp>;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule], controllers: [BackOfficeProbeController] }));
    app = await createFastifyApp(moduleRef);
    http = adminHttp(app);
  });

  beforeEach(async () => {
    useFakeDate();
    await resetDatabase(prisma);
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  afterEach(() => jest.useRealTimers());

  afterAll(() => app?.close());

  const signInFull = async (admin: { email: string; secret: string }) => {
    const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    expect(res.statusCode).toBe(200);
    return res;
  };

  describe("criterion 1: an admin without TOTP gets a session only the enrolment routes accept", () => {
    it("password alone gives an enrolment session; sessions list, revoke, reauth and any other back-office route answer 403", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const signIn = await http.signIn({ email: "New@Example.com", password: ADMIN_PASSWORD });
      const cookie = accessCookie(signIn);
      const sessionId = (await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id } })).id;

      const list = await http.call("GET", "/admin/auth/sessions", { cookie });
      const revoke = await http.call("DELETE", `/admin/auth/sessions/${sessionId}`, { cookie });
      const reauth = await http.call("POST", "/admin/auth/reauth", { cookie }, { password: ADMIN_PASSWORD, totp: "123456" });
      const probe = await http.call("GET", "/admin/probe", { cookie });

      expect(signIn.statusCode).toBe(200);
      expect(signIn.json()).toEqual({ scope: "enrolment" });
      expect([list.statusCode, revoke.statusCode, reauth.statusCode, probe.statusCode]).toEqual([403, 403, 403, 403]);
      expect((await prisma.adminSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt).toBeNull();
    });

    it("enrol and confirm: 200; the secret is stored encrypted; 10 recovery codes once; the session becomes a full one", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const enrolmentCookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));

      const enrol = await http.call("POST", "/admin/auth/totp/enrol", { cookie: enrolmentCookie });
      const { secret, otpauthUri } = enrol.json();
      const stored = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
      const confirm = await http.call("POST", "/admin/auth/totp/confirm", { cookie: enrolmentCookie }, { code: totpCode(secret) });
      const fullCookie = accessCookie(confirm);
      const { recoveryCodes } = confirm.json();

      expect(enrol.statusCode).toBe(200);
      expect(enrol.headers["cache-control"]).toBe("no-store");
      expect(otpauthUri).toBe(`otpauth://totp/Renovix%20Admin:new%40example.com?secret=${secret}&issuer=Renovix%20Admin`);
      expect(stored.totpSecretEncrypted).toMatch(/^v1\./);
      expect(stored.totpSecretEncrypted).not.toContain(secret);
      expect(stored.totpEnrolledAt).toBeNull();
      expect(confirm.statusCode).toBe(200);
      expect(confirm.headers["cache-control"]).toBe("no-store");
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes) expect(code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
      const rows = await prisma.adminRecoveryCode.findMany({ where: { adminId: admin.id } });
      expect(rows).toHaveLength(10);
      expect(rows.map((row) => row.codeHash)).not.toContain(recoveryCodes[0].replace(/-/g, ""));
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.codeHash) && row.usedAt === null)).toBe(true);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).totpEnrolledAt).not.toBeNull();
      expect((await http.call("GET", "/admin/probe", { cookie: enrolmentCookie })).statusCode).toBe(401);
      expect((await http.call("GET", "/admin/probe", { cookie: fullCookie })).statusCode).toBe(200);
      expect((await http.call("GET", "/admin/auth/sessions", { cookie: fullCookie })).statusCode).toBe(200);
      expect((await http.call("POST", "/admin/auth/totp/enrol", { cookie: fullCookie })).statusCode).toBe(403);
      expect((await http.call("POST", "/admin/auth/totp/confirm", { cookie: fullCookie }, { code: "123456" })).statusCode).toBe(403);
    });

    it("confirm with a wrong code: 400, not enrolled, no recovery codes, the session stays an enrolment one", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const cookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));
      const { secret } = (await http.call("POST", "/admin/auth/totp/enrol", { cookie })).json();
      const wrong = String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, "0");

      const res = await http.call("POST", "/admin/auth/totp/confirm", { cookie }, { code: wrong });

      expect(res.statusCode).toBe(400);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).totpEnrolledAt).toBeNull();
      expect(await prisma.adminRecoveryCode.count()).toBe(0);
      expect((await http.call("GET", "/admin/probe", { cookie })).statusCode).toBe(403);
    });

    it("confirm before enrol: 400", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const cookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));

      const res = await http.call("POST", "/admin/auth/totp/confirm", { cookie }, { code: "123456" });

      expect(res.statusCode).toBe(400);
    });

    it("an enrolled admin with password only does not get an enrolment session: 401", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD });

      expect(res.statusCode).toBe(401);
      expect(setCookies(res)).toEqual([]);
    });

    it("an enrolment session may sign out", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const cookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));

      expect((await http.call("POST", "/admin/auth/sign-out", { cookie })).statusCode).toBe(204);
      expect((await http.call("POST", "/admin/auth/totp/enrol", { cookie })).statusCode).toBe(401);
    });
  });

  describe("criterion 4: product credentials on a back-office auth route are refused", () => {
    let user: { id: string; email: string };

    beforeEach(async () => {
      user = await createUser(prisma);
      await createApiKey(prisma, user.id, { apiKey: API_KEY });
    });

    const loginJwt = () => `Bearer ${jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET!)}`;

    it.each(["GET /admin/auth/sessions", "POST /admin/auth/sign-out", "POST /admin/auth/totp/enrol"])(
      "%s: a valid login JWT, a valid API key, a valid better-auth cookie and nothing: each 401",
      async (route) => {
        const [method, url] = route.split(" ") as ["GET" | "POST", string];
        const withJwt = await http.call(method, url, { authorization: loginJwt() });
        const withKey = await http.call(method, url, { authorization: `Bearer ${API_KEY}` });
        mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });
        const withBetterAuth = await http.call(method, url, { cookie: "better-auth.session_token=rx94" });
        mockGetSession.mockResolvedValue(null);
        const withNothing = await http.call(method, url);

        expect([withJwt.statusCode, withKey.statusCode, withBetterAuth.statusCode, withNothing.statusCode]).toEqual([401, 401, 401, 401]);
      },
    );

    it("the login JWT inside the admin cookie: 401", async () => {
      const res = await http.call("GET", "/admin/auth/sessions", { cookie: `rx_admin_access=${loginJwt().slice(7)}` });

      expect(res.statusCode).toBe(401);
    });

    it("sign-in does not accept a product user's email and password", async () => {
      const res = await http.signIn({ email: user.email, password: ADMIN_PASSWORD });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
    });
  });

  describe("generic error copy (no account enumeration)", () => {
    it("unknown email, wrong password, wrong TOTP, missing TOTP and locked: the same 401 body", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const locked = await createAdmin(prisma, moduleRef, { email: "locked@example.com", enrolled: true });
      await prisma.adminUser.update({ where: { id: locked.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
      const wrongCode = String((Number(totpCode(admin.secret)) + 1) % 1_000_000).padStart(6, "0");

      const answers = [
        await http.signIn({ email: "nobody@example.com", password: ADMIN_PASSWORD, totp: "123456" }),
        await http.signIn({ email: admin.email, password: WRONG_PASSWORD, totp: totpCode(admin.secret) }),
        await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: wrongCode }),
        await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }),
        await http.signIn({ email: locked.email, password: ADMIN_PASSWORD, totp: totpCode(locked.secret) }),
      ];

      for (const res of answers) {
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual(GENERIC_401);
        expect(setCookies(res)).toEqual([]);
      }
    });

    it("an unknown email still verifies a password hash (the dummy one)", async () => {
      const verify = jest.spyOn(moduleRef.get(PasswordService), "verify");

      await http.signIn({ email: "nobody@example.com", password: ADMIN_PASSWORD });

      expect(verify).toHaveBeenCalledWith(undefined, ADMIN_PASSWORD);
      verify.mockRestore();
    });

    it("a malformed body: 400 (no account is looked up)", async () => {
      const res = await http.signIn({ email: "not-an-email", password: ADMIN_PASSWORD, totp: "12ab56" });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("cookies", () => {
    it("sign-in sets the access cookie (HttpOnly, Secure, SameSite=Strict, Path=/, 15 min) and the refresh cookie (refresh path, 12 h); no Domain; no token in the body", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });

      const res = await signInFull(admin);
      const [access, refresh] = setCookies(res);

      expect(setCookies(res)).toHaveLength(2);
      expect(access).toMatch(/^rx_admin_access=[A-Za-z0-9._-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=900$/);
      expect(refresh).toMatch(
        /^rx_admin_refresh=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; Path=\/api\/v1\/admin\/auth\/refresh; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/,
      );
      expect(setCookies(res).join(";")).not.toMatch(/domain/i);
      expect(res.json()).toEqual({ scope: "full" });
    });

    it("only the refresh token's hash is stored", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const token = refreshCookie(await signInFull(admin)).split("=")[1];

      const row = await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id } });

      expect(JSON.stringify(row)).not.toContain(token);
      expect(JSON.stringify(row)).not.toContain(token.split(".")[1]);
    });
  });

  describe("sessions", () => {
    it("lists the admin's own live sessions without hashes, marks the current one", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const other = await createAdmin(prisma, moduleRef, { email: "fin@example.com", enrolled: true });
      await signInFull(other);
      await signInFull(admin);
      nextStep();
      const cookie = accessCookie(await signInFull(admin));

      const res = await http.call("GET", "/admin/auth/sessions", { cookie });
      const { sessions } = res.json();

      expect(res.statusCode).toBe(200);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s: { current: boolean }) => s.current).sort()).toEqual([false, true]);
      expect(Object.keys(sessions[0]).sort()).toEqual(
        ["absoluteExpiresAt", "createdAt", "current", "id", "lastReauthAt", "lastSeenAt", "scope", "userAgent"],
      );
      expect(res.body).not.toMatch(/hash/i);
    });

    it("revoke: another admin's session 404 (it keeps working), an unknown id 404, an own session 204 (it stops working)", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const other = await createAdmin(prisma, moduleRef, { email: "fin@example.com", enrolled: true });
      const otherCookie = accessCookie(await signInFull(other));
      const firstCookie = accessCookie(await signInFull(admin));
      nextStep();
      const cookie = accessCookie(await signInFull(admin));
      const otherSession = await prisma.adminSession.findFirstOrThrow({ where: { adminId: other.id } });
      const [first] = await prisma.adminSession.findMany({ where: { adminId: admin.id }, orderBy: { lastSeenAt: "asc" } });

      const foreign = await http.call("DELETE", `/admin/auth/sessions/${otherSession.id}`, { cookie });
      const unknown = await http.call("DELETE", "/admin/auth/sessions/00000000-0000-4000-8000-000000000000", { cookie });
      const own = await http.call("DELETE", `/admin/auth/sessions/${first.id}`, { cookie });

      expect([foreign.statusCode, unknown.statusCode, own.statusCode]).toEqual([404, 404, 204]);
      expect((await http.call("GET", "/admin/probe", { cookie: otherCookie })).statusCode).toBe(200);
      expect((await http.call("GET", "/admin/probe", { cookie: firstCookie })).statusCode).toBe(401);
      expect((await http.call("GET", "/admin/probe", { cookie })).statusCode).toBe(200);
    });

    it("sign-out ends the session and clears both cookies; its refresh token no longer works", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const signIn = await signInFull(admin);

      const res = await http.call("POST", "/admin/auth/sign-out", { cookie: accessCookie(signIn) });

      expect(res.statusCode).toBe(204);
      expect(setCookies(res)).toEqual([
        "rx_admin_access=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
        "rx_admin_refresh=; Path=/api/v1/admin/auth/refresh; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
      ]);
      expect((await http.call("GET", "/admin/probe", { cookie: accessCookie(signIn) })).statusCode).toBe(401);
      expect((await http.refresh(refreshCookie(signIn))).statusCode).toBe(401);
    });
  });
});
