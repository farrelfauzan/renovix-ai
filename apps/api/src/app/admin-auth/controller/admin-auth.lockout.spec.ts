import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../admin-auth.module";
import { PasswordService } from "../service/password.service";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  accessCookie,
  ADMIN_PASSWORD,
  adminHttp,
  advance,
  BackOfficeProbeController,
  createAdmin,
  MINUTE,
  nextStep,
  refreshCookie,
  totpCode,
  useFakeDate,
  WRONG_PASSWORD,
} from "../../../../test/admin-auth";

// RX-94 through real HTTP on the test database: lockout (criterion 2), the second factor (TOTP step reuse,
// recovery codes), re-authentication, and no secret in the logs.
const GENERIC_401 = { statusCode: 401, message: "Invalid credentials", error: "Unauthorized" };

describe("Back-office sign-in: lockout and second factor (RX-94, Fastify, test database)", () => {
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
  });

  afterEach(() => jest.useRealTimers());

  afterAll(() => app?.close());

  const otherCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
  const adminRow = (id: string) => prisma.adminUser.findUniqueOrThrow({ where: { id } });

  describe("criterion 2: 5 failed attempts lock the account for 15 minutes and notify the owner role", () => {
    it("5 wrong passwords: locked 15 minutes, one owner notification; the right password is refused until then; works after", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const lockedAt = Date.now();

      for (let i = 0; i < 5; i++) {
        const res = await http.signIn({ email: admin.email, password: WRONG_PASSWORD, totp: totpCode(admin.secret) });
        expect(res.json()).toEqual(GENERIC_401);
      }
      const row = await adminRow(admin.id);
      const notifications = await prisma.adminNotification.findMany();
      const sixth = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      advance(15 * MINUTE - 1_000);
      const justBefore = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      advance(2_000);
      const after = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect(row.lockedUntil?.getTime()).toBe(lockedAt + 15 * MINUTE);
      expect(row.failedAttempts).toBe(0);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ recipientRole: "owner", kind: "lockout", subjectAdminId: admin.id, readAt: null });
      expect(sixth.statusCode).toBe(401);
      expect(sixth.json()).toEqual(GENERIC_401);
      expect(justBefore.statusCode).toBe(401);
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual({ scope: "full" });
      expect(await adminRow(admin.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
      expect(await prisma.adminNotification.count()).toBe(1);
    });

    it("5 wrong TOTP codes with the right password also lock", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });

      for (let i = 0; i < 5; i++) {
        await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: otherCode(totpCode(admin.secret)) });
      }

      expect((await adminRow(admin.id)).lockedUntil).not.toBeNull();
      expect(await prisma.adminNotification.count()).toBe(1);
      expect((await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) })).statusCode).toBe(401);
    });

    it("4 failures then a success: not locked, the count starts again", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      for (let i = 0; i < 4; i++) await http.signIn({ email: admin.email, password: WRONG_PASSWORD, totp: "000000" });

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect(res.statusCode).toBe(200);
      expect(await adminRow(admin.id)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
      expect(await prisma.adminNotification.count()).toBe(0);
    });

    it("attempts while locked neither extend the lock nor add a notification", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      for (let i = 0; i < 5; i++) await http.signIn({ email: admin.email, password: WRONG_PASSWORD, totp: "000000" });
      const lockedUntil = (await adminRow(admin.id)).lockedUntil;
      advance(MINUTE);

      for (let i = 0; i < 6; i++) await http.signIn({ email: admin.email, password: WRONG_PASSWORD, totp: "000000" });

      expect((await adminRow(admin.id)).lockedUntil).toEqual(lockedUntil);
      expect(await prisma.adminNotification.count()).toBe(1);
    });
  });

  describe("M1: a lock set while a correct sign-in or re-authentication is in flight", () => {
    /** Pauses the next password check: after Argon2 answered, the lock is set (as a parallel failure would), then it continues. */
    const lockDuringPasswordCheck = (adminId: string) => {
      const passwords = moduleRef.get(PasswordService);
      const original = passwords.verify.bind(passwords);
      return jest.spyOn(passwords, "verify").mockImplementationOnce(async (hash, password) => {
        const matches = await original(hash, password);
        await prisma.adminUser.update({ where: { id: adminId }, data: { lockedUntil: new Date(Date.now() + 15 * MINUTE) } });
        return matches;
      });
    };

    it("sign-in with the right password and TOTP: 401, no session, the lock stays", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const spy = lockDuringPasswordCheck(admin.id);

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      const calls = spy.mock.calls.length;
      spy.mockRestore();

      expect(calls).toBe(1);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
      expect(await prisma.adminSession.count()).toBe(0);
      expect((await adminRow(admin.id)).lockedUntil).not.toBeNull();
    });

    it("sign-in before enrolment (password alone): 401, no session, the lock stays", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const spy = lockDuringPasswordCheck(admin.id);

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD });
      spy.mockRestore();

      expect(res.statusCode).toBe(401);
      expect(await prisma.adminSession.count()).toBe(0);
      expect((await adminRow(admin.id)).lockedUntil).not.toBeNull();
    });

    it("re-authentication with the right password and TOTP: 401, nothing recorded, the lock stays", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const cookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) }));
      nextStep();
      const spy = lockDuringPasswordCheck(admin.id);

      const res = await http.call("POST", "/admin/auth/reauth", { cookie }, { password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      spy.mockRestore();

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
      expect((await prisma.adminSession.findFirstOrThrow()).lastReauthAt).toBeNull();
      expect((await adminRow(admin.id)).lockedUntil).not.toBeNull();
    });
  });

  describe("TOTP step reuse", () => {
    it("the same code twice: the second sign-in is refused (and counted)", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const code = totpCode(admin.secret);

      const first = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: code });
      const second = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: code });
      nextStep();
      const nextCode = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect([first.statusCode, second.statusCode, nextCode.statusCode]).toEqual([200, 401, 200]);
      expect(second.json()).toEqual(GENERIC_401);
    });

    it("the same code in two parallel sign-ins: exactly one succeeds", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const body = { email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) };

      const results = await Promise.all([http.signIn(body), http.signIn(body), http.signIn(body)]);

      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 401, 401]);
      expect(await prisma.adminSession.count()).toBe(1);
    });

    it("the code of the previous step is accepted (±1 step), one from two steps back is not", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const old = totpCode(admin.secret);
      nextStep();
      const oneBack = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: old });
      const other = await createAdmin(prisma, moduleRef, { email: "fin@example.com", enrolled: true });
      const otherOld = totpCode(other.secret);
      nextStep();
      nextStep();
      const twoBack = await http.signIn({ email: other.email, password: ADMIN_PASSWORD, totp: otherOld });

      expect(oneBack.statusCode).toBe(200);
      expect(twoBack.statusCode).toBe(401);
    });

    it("a TOTP secret copied to another admin's row does not decrypt there (bound to the admin id)", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const other = await createAdmin(prisma, moduleRef, { email: "fin@example.com", enrolled: true });
      const { totpSecretEncrypted } = await adminRow(admin.id);
      await prisma.adminUser.update({ where: { id: other.id }, data: { totpSecretEncrypted } });

      const res = await http.signIn({ email: other.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
      expect(await adminRow(other.id)).toMatchObject({ lastAcceptedTimeStep: null, failedAttempts: 1 });
    });

    // L2: an error inside the second-factor check comes after the password matched, so a 500 would say
    // "the password was right". It is a failed second factor: the generic 401, counted.
    it("a stored step far in the future (otplib throws AfterTimeStepRangeExceededError): 401, counted, not 500", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const farFuture = Math.floor(Date.now() / 30_000) + 1_000;
      await prisma.adminUser.update({ where: { id: admin.id }, data: { lastAcceptedTimeStep: farFuture } });
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      const warned = warn.mock.calls.map((call) => String(call[0]));
      warn.mockRestore();

      expect(warned).toEqual([`TOTP check failed for admin ${admin.id}: AfterTimeStepRangeExceededError`]);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
      expect(await adminRow(admin.id)).toMatchObject({ lastAcceptedTimeStep: farFuture, failedAttempts: 1 });
    });

    it.each([
      ["a flipped byte", (stored: string) => `v1.${Buffer.from(Buffer.from(stored.slice(3), "base64").map((b, i) => (i === 40 ? b ^ 1 : b))).toString("base64")}`],
      ["a truncated value", (stored: string) => stored.slice(0, 20)],
    ])("a corrupted encrypted secret (%s): 401, counted, not 500, nothing secret logged", async (_case, corrupt) => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const { totpSecretEncrypted } = await adminRow(admin.id);
      await prisma.adminUser.update({ where: { id: admin.id }, data: { totpSecretEncrypted: corrupt(totpSecretEncrypted!) } });
      const lines: string[] = [];
      const record = (...args: unknown[]) => void lines.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
      const spies = [
        ...(["log", "warn", "error", "debug", "verbose", "fatal"] as const).map((level) => jest.spyOn(Logger.prototype, level).mockImplementation(record)),
        ...(["log", "warn", "error", "debug", "verbose", "fatal"] as const).map((level) => jest.spyOn(Logger, level).mockImplementation(record)),
      ];
      const code = totpCode(admin.secret);

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: code });
      spies.forEach((spy) => spy.mockRestore());

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
      expect((await adminRow(admin.id)).failedAttempts).toBe(1);
      expect(lines.join("\n")).toContain("TOTP check failed");
      for (const value of [ADMIN_PASSWORD, admin.secret, totpSecretEncrypted!]) expect(lines.join("\n")).not.toContain(value);
      expect(lines.join("\n")).not.toMatch(new RegExp(`(^|[^0-9a-f])${code}([^0-9a-f]|$)`));
    });
  });

  describe("recovery codes", () => {
    const enrolViaApi = async (email: string) => {
      const admin = await createAdmin(prisma, moduleRef, { email });
      const cookie = accessCookie(await http.signIn({ email, password: ADMIN_PASSWORD }));
      const { secret } = (await http.call("POST", "/admin/auth/totp/enrol", { cookie })).json();
      const confirm = await http.call("POST", "/admin/auth/totp/confirm", { cookie }, { code: totpCode(secret) });
      return { ...admin, secret, recoveryCodes: confirm.json().recoveryCodes as string[] };
    };

    it("a recovery code signs in once (full session); used again it is refused; another code works in any case and without dashes", async () => {
      const admin = await enrolViaApi("ops@example.com");
      const [first, second] = admin.recoveryCodes;

      const once = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, recoveryCode: first });
      const again = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, recoveryCode: first });
      const other = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, recoveryCode: second.toUpperCase().replace(/-/g, "") });

      expect(once.statusCode).toBe(200);
      expect(once.json()).toEqual({ scope: "full" });
      expect(again.statusCode).toBe(401);
      expect(again.json()).toEqual(GENERIC_401);
      expect(other.statusCode).toBe(200);
      expect(await prisma.adminRecoveryCode.count({ where: { adminId: admin.id, usedAt: { not: null } } })).toBe(2);
    });

    it("a recovery code needs the right password", async () => {
      const admin = await enrolViaApi("ops@example.com");

      const res = await http.signIn({ email: admin.email, password: WRONG_PASSWORD, recoveryCode: admin.recoveryCodes[0] });

      expect(res.statusCode).toBe(401);
      expect(await prisma.adminRecoveryCode.count({ where: { usedAt: { not: null } } })).toBe(0);
    });

    it("another admin's recovery code is refused", async () => {
      const admin = await enrolViaApi("ops@example.com");
      nextStep();
      const other = await enrolViaApi("fin@example.com");

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, recoveryCode: other.recoveryCodes[0] });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("re-authentication", () => {
    it("password + fresh TOTP: 204; a reauth: true route accepts the session for 2 minutes (RX-95)", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const cookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) }));
      const before = await http.call("GET", "/admin/probe/sensitive", { cookie });
      nextStep();

      const reauth = await http.call("POST", "/admin/auth/reauth", { cookie }, { password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      const within = await http.call("GET", "/admin/probe/sensitive", { cookie });
      advance(2 * MINUTE + 1_000);
      const after = await http.call("GET", "/admin/probe/sensitive", { cookie });

      expect([before.statusCode, reauth.statusCode, within.statusCode, after.statusCode]).toEqual([403, 204, 200, 403]);
    });

    it.each([
      ["a wrong password", (secret: string) => ({ password: WRONG_PASSWORD, totp: totpCode(secret) })],
      ["the TOTP code already used to sign in", (secret: string) => ({ password: ADMIN_PASSWORD, totp: totpCode(secret) })],
    ])("%s: 401 with the generic body, counted, no re-authentication recorded", async (_case, body) => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com", enrolled: true });
      const cookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) }));

      const res = await http.call("POST", "/admin/auth/reauth", { cookie }, body(admin.secret));

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(GENERIC_401);
      expect((await adminRow(admin.id)).failedAttempts).toBe(1);
      expect((await prisma.adminSession.findFirstOrThrow()).lastReauthAt).toBeNull();
    });
  });

  describe("no secret in the logs", () => {
    it("enrolment, sign-in, lockout and refresh-token reuse log nothing secret (and the spy sees the lockout and reuse lines)", async () => {
      const lines: string[] = [];
      const record = (...args: unknown[]) => void lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      const spies = [
        ...(["log", "warn", "error", "debug", "verbose", "fatal"] as const).map((level) => jest.spyOn(Logger.prototype, level).mockImplementation(record)),
        ...(["log", "warn", "error", "debug", "verbose", "fatal"] as const).map((level) => jest.spyOn(Logger, level).mockImplementation(record)),
        ...(["log", "warn", "error", "info", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(record)),
      ];
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com" });
      const enrolmentCookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));
      const { secret } = (await http.call("POST", "/admin/auth/totp/enrol", { cookie: enrolmentCookie })).json();
      const confirmCode = totpCode(secret);
      const confirm = await http.call("POST", "/admin/auth/totp/confirm", { cookie: enrolmentCookie }, { code: confirmCode });
      const { recoveryCodes } = confirm.json();
      nextStep();
      const signInCode = totpCode(secret);
      const signIn = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: signInCode });
      const refresh = refreshCookie(signIn);
      await http.refresh(refresh);
      await http.refresh(refresh);
      for (let i = 0; i < 5; i++) await http.signIn({ email: admin.email, password: WRONG_PASSWORD, totp: "000000" });
      spies.forEach((spy) => spy.mockRestore());
      const logged = lines.join("\n");
      const secrets = [ADMIN_PASSWORD, WRONG_PASSWORD, secret, ...recoveryCodes, refresh.split("=")[1], refresh.split(".")[1], accessCookie(signIn).split("=")[1], enrolmentCookie.split("=")[1]];

      expect(logged).toContain("locked for 15 minutes after 5 failed sign-in attempts");
      expect(logged).toContain("a rotated refresh token was used again");
      for (const value of secrets) expect(logged).not.toContain(value);
      for (const code of [confirmCode, signInCode]) expect(logged).not.toMatch(new RegExp(`(^|[^0-9a-f])${code}([^0-9a-f]|$)`));
    });
  });
});
