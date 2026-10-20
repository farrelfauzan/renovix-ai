import { Body, Controller, HttpCode, Logger, Param, Post, Req, Res } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import type { FastifyReply } from "fastify";
import { inspect } from "node:util";
import { Access } from "../../../common/decorators/access.decorator";
import { AdminAuthModule } from "../admin-auth.module";
import { AdminAudit } from "../decorator/admin-audit.decorator";
import { AdminAuditLogRepository } from "../repository/admin-audit-log.repository";
import { AdminSessionRepository } from "../repository/admin-session.repository";
import { AdminSessionService } from "../service/admin-session.service";
import { PiiRevealService } from "../service/pii-reveal.service";
import type { AdminRequest } from "../types/admin-request";
import type { AuditedAdminRequest } from "../types/audited-admin-request";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import {
  accessCookie,
  ADMIN_PASSWORD,
  adminHttp,
  BACK_OFFICE_ORIGIN,
  createAdmin,
  nextStep,
  refreshCookie,
  setCookies,
  START,
  totpCode,
  useFakeDate,
} from "../../../../test/admin-auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/; // RX-166: request ids are random UUIDs

// RX-97 (D57, D61): the back-office audit log through real HTTP (Fastify `inject`) on the test database.
// The probe routes below exist only in this spec: main has no personal-data route yet (RX-95 and later).

@Controller("admin/audit-probe")
class AuditProbeController {
  constructor(
    private readonly pii: PiiRevealService,
    private readonly sessions: AdminSessionRepository,
  ) {}

  /** Stands for a future reveal route: the reveal writes its own audit row, so the route is exempt from the write hook. */
  @Post("pii/:userId")
  @Access({ auth: ["staff"] })
  @AdminAudit({ exempt: true, reason: "a reveal writes its own audit row (PiiRevealService.authorizeReveal)" })
  @HttpCode(200)
  async reveal(@Req() req: AdminRequest, @Param("userId") userId: string, @Body("reason") reason: unknown) {
    await this.pii.authorizeReveal(req.admin, userId, reason, req.id);
    return { revealed: true };
  }

  /** An audited route whose handler writes but forgets to record the change. */
  @Post("forgets-record")
  @Access({ auth: ["staff"] })
  @AdminAudit({ resource: "probe", action: "forgets_record" })
  @HttpCode(204)
  async forgetsRecord(@Req() req: AuditedAdminRequest) {
    await this.sessions.revoke(req.admin.sessionId, new Date(), req.audit.tx);
  }

  /** An audited route whose handler sets a cookie, then fails (RNX-167). */
  @Post("cookie-then-fail")
  @Access({ auth: ["staff"] })
  @AdminAudit({ resource: "probe", action: "cookie_then_fail" })
  @HttpCode(204)
  async cookieThenFail(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.header("set-cookie", "probe=1; Path=/; HttpOnly");
    throw new Error("handler failed after setting a cookie (test)");
  }
}

const ACCESS = "rx_admin_access";
/** Personal data of the user whose data is revealed: it must reach the audit row's reason only, never a log. */
const USER_EMAIL = "pii-marker-rx97@example.com";
const REVEAL_REASON = `ticket 4711: user ${USER_EMAIL} asked about an invoice`;
const LOG_LEVELS = ["log", "error", "warn", "debug", "verbose", "fatal"] as const;
const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

/** Everything written to the Nest Logger, the console, stdout and stderr while `work` runs. */
async function captureLogs(work: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const keep = (...args: unknown[]): void => {
    lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : typeof arg === "string" ? arg : inspect(arg, { depth: 8 }))).join(" "));
  };
  const write = (chunk: string | Uint8Array): boolean => {
    keep(String(chunk));
    return true;
  };
  const spies = [
    ...LOG_LEVELS.map((level) => jest.spyOn(Logger.prototype, level).mockImplementation(keep)),
    ...LOG_LEVELS.map((level) => jest.spyOn(Logger, level).mockImplementation(keep)),
    ...CONSOLE_LEVELS.map((level) => jest.spyOn(console, level).mockImplementation(keep)),
    jest.spyOn(process.stdout, "write").mockImplementation(write),
    jest.spyOn(process.stderr, "write").mockImplementation(write),
  ];
  try {
    await work();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return lines.join("\n");
}

describe("Back-office audit log (RX-97, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof adminHttp>;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      imports: [AdminAuthModule],
      controllers: [AuditProbeController],
      providers: [PiiRevealService],
    }));
    app = await createFastifyApp(moduleRef);
    http = adminHttp(app);
  });

  beforeEach(async () => {
    useFakeDate();
    await resetDatabase(prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => app?.close());

  /** An enrolled admin signed in twice (sessions A and B, oldest first); `cookie` is session A's access cookie. */
  const signedInTwice = async (role = "operations") => {
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}@example.com`, enrolled: true, role });
    const first = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    nextStep();
    const second = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const [sessionA, sessionB] = await prisma.adminSession.findMany({ where: { adminId: admin.id }, orderBy: { createdAt: "asc" } });
    return { admin, first, second, sessionA, sessionB, cookie: accessCookie(first) };
  };
  /** An admin of this role with a full session started directly (no sign-in); returns the admin id and the access cookie. */
  const startedSession = async (role: string) => {
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}-direct@example.com`, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const revoke = (cookie: string, sessionId: string) => http.call("DELETE", `/admin/auth/sessions/${sessionId}`, { cookie });
  const revealPii = (cookie: string, userId: string, payload: object) =>
    app.inject({ method: "POST", url: `/admin/audit-probe/pii/${userId}`, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  const auditRows = () => prisma.adminAuditLog.findMany({ orderBy: { createdAt: "asc" } });
  const revokedAt = async (sessionId: string) => (await prisma.adminSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt;

  describe("AC1: a signed-in admin revokes one of their sessions", () => {
    it("exactly one audit row: admin, resource, action, before and after, reason, request id, effective time", async () => {
      const { admin, sessionB, cookie } = await signedInTwice();

      const res = await revoke(cookie, sessionB.id);

      expect(res.statusCode).toBe(204);
      expect(await revokedAt(sessionB.id)).not.toBeNull();
      expect(await auditRows()).toEqual([
        {
          id: expect.any(String),
          adminId: admin.id,
          resource: "admin_session",
          action: "revoke",
          before: { sessionId: sessionB.id, revoked: false },
          after: { sessionId: sessionB.id, revoked: true },
          reason: "",
          requestId: expect.stringMatching(UUID_PATTERN),
          effectiveAt: new Date(Date.now()),
          createdAt: expect.any(Date),
        },
      ]);
    });

    it("a refused write writes no row: another admin's session (404) and an enrolment session (403)", async () => {
      const { sessionB } = await signedInTwice();
      const other = await createAdmin(prisma, moduleRef, { email: "other@example.com", enrolled: true });
      nextStep();
      const otherCookie = accessCookie(await http.signIn({ email: other.email, password: ADMIN_PASSWORD, totp: totpCode(other.secret) }));
      const newcomer = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const enrolmentCookie = accessCookie(await http.signIn({ email: newcomer.email, password: ADMIN_PASSWORD }));

      const responses = [await revoke(otherCookie, sessionB.id), await revoke(enrolmentCookie, sessionB.id)];

      expect(responses.map((res) => res.statusCode)).toEqual([404, 403]);
      expect(await revokedAt(sessionB.id)).toBeNull();
      expect(await auditRows()).toEqual([]);
    });
  });

  describe("every audited route writes one row with non-secret values", () => {
    it("enrol, confirm, reauth, sign-out: one row each, in order, with no secret, token, code or hash in them", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const enrolmentCookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));
      const enrolmentSession = await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id } });
      const enrol = await http.call("POST", "/admin/auth/totp/enrol", { cookie: enrolmentCookie });
      const { secret } = enrol.json();
      const confirm = await http.call("POST", "/admin/auth/totp/confirm", { cookie: enrolmentCookie }, { code: totpCode(secret) });
      const fullCookie = accessCookie(confirm);
      const fullSession = await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id, scope: "full" } });
      nextStep();
      const reauth = await http.call("POST", "/admin/auth/reauth", { cookie: fullCookie }, { password: ADMIN_PASSWORD, totp: totpCode(secret) });
      const signOut = await http.call("POST", "/admin/auth/sign-out", { cookie: fullCookie });
      const rows = await auditRows();
      const stored = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
      const secrets = [ADMIN_PASSWORD, secret, stored.passwordHash, stored.totpSecretEncrypted ?? "", ...confirm.json().recoveryCodes];

      expect([enrol.statusCode, confirm.statusCode, reauth.statusCode, signOut.statusCode]).toEqual([200, 200, 204, 204]);
      expect(rows.map(({ adminId, resource, action, before, after, reason }) => ({ adminId, resource, action, before, after, reason }))).toEqual([
        { adminId: admin.id, resource: "admin_totp", action: "enrol", before: { totpEnrolled: false }, after: { totpEnrolled: false, newSecretIssued: true }, reason: "" },
        {
          adminId: admin.id,
          resource: "admin_totp",
          action: "confirm",
          before: { totpEnrolled: false, sessionId: enrolmentSession.id, scope: "enrolment" },
          after: { totpEnrolled: true, sessionId: fullSession.id, scope: "full", recoveryCodesIssued: 10 },
          reason: "",
        },
        { adminId: admin.id, resource: "admin_session", action: "reauth", before: { sessionId: fullSession.id }, after: { sessionId: fullSession.id, reauthenticated: true }, reason: "" },
        { adminId: admin.id, resource: "admin_session", action: "sign_out", before: { sessionId: fullSession.id, revoked: false }, after: { sessionId: fullSession.id, revoked: true }, reason: "" },
      ]);
      expect(new Set(rows.map((row) => row.requestId)).size).toBe(4);
      const written = JSON.stringify(rows);
      for (const value of secrets) expect(written).not.toContain(value);
      expect(written).not.toContain(refreshCookie(confirm).split("=")[1]);
      expect(written).not.toContain(fullCookie.split("=")[1]);
    });

    it("exempt routes write no row: sign-in and refresh", async () => {
      const { first } = await signedInTwice();

      const refreshed = await http.refresh(refreshCookie(first));

      expect(refreshed.statusCode).toBe(200);
      expect(await auditRows()).toEqual([]);
    });
  });

  describe("AC2: the audit log is append-only in the database", () => {
    const writeRow = async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "ops@example.com" });
      await moduleRef.get(AdminAuditLogRepository).create({
        adminId: admin.id,
        resource: "admin_session",
        action: "revoke",
        before: { sessionId: "s-1", revoked: false },
        after: { sessionId: "s-1", revoked: true },
        reason: "",
        requestId: "req-test",
        effectiveAt: START,
      });
      return { admin, row: await prisma.adminAuditLog.findFirstOrThrow() };
    };

    it("UPDATE and DELETE from the application (Prisma client) are refused; the row is unchanged", async () => {
      const { row } = await writeRow();

      const attempts = await Promise.allSettled([
        prisma.adminAuditLog.update({ where: { id: row.id }, data: { reason: "rewritten" } }),
        prisma.adminAuditLog.updateMany({ data: { after: { revoked: false } } }),
        prisma.adminAuditLog.delete({ where: { id: row.id } }),
        prisma.adminAuditLog.deleteMany(),
      ]);

      expect(attempts.map((attempt) => attempt.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
      for (const attempt of attempts) expect(String((attempt as PromiseRejectedResult).reason)).toContain("append-only");
      expect(await auditRows()).toEqual([row]);
    });

    it("UPDATE and DELETE in direct SQL are refused, even one that matches no row; the row is unchanged", async () => {
      const { row } = await writeRow();

      const attempts = await Promise.allSettled([
        prisma.$executeRawUnsafe(`UPDATE "admin_audit_log" SET "reason" = 'rewritten'`),
        prisma.$executeRawUnsafe(`UPDATE "admin_audit_log" SET "admin_id" = "admin_id" WHERE false`),
        prisma.$executeRawUnsafe(`DELETE FROM "admin_audit_log"`),
        prisma.$executeRawUnsafe(`DELETE FROM "admin_audit_log" WHERE "id" = $1`, row.id),
      ]);

      expect(attempts.map((attempt) => attempt.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
      for (const attempt of attempts) expect(String((attempt as PromiseRejectedResult).reason)).toContain("append-only");
      expect(await auditRows()).toEqual([row]);
    });

    it("an admin who has audit rows cannot be deleted (foreign key RESTRICT); the row is unchanged", async () => {
      const { admin, row } = await writeRow();

      await expect(prisma.adminUser.delete({ where: { id: admin.id } })).rejects.toThrow();

      expect(await auditRows()).toEqual([row]);
    });

    it("the test reset (TRUNCATE) still empties the table", async () => {
      await writeRow();

      await resetDatabase(prisma);

      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  describe("AC5: the write and its audit row are one transaction", () => {
    it("the audit insert fails: 500, the session is not revoked, no row; the same request then succeeds", async () => {
      const { sessionB, cookie } = await signedInTwice();
      jest.spyOn(AdminAuditLogRepository.prototype, "create").mockRejectedValueOnce(new Error("audit insert refused (test)"));

      const failed = await revoke(cookie, sessionB.id);
      const revokedAfterFailure = await revokedAt(sessionB.id);
      const rowsAfterFailure = await auditRows();
      const retried = await revoke(cookie, sessionB.id);

      expect(failed.statusCode).toBe(500);
      expect(revokedAfterFailure).toBeNull();
      expect(rowsAfterFailure).toEqual([]);
      expect(retried.statusCode).toBe(204);
      expect(await revokedAt(sessionB.id)).not.toBeNull();
      expect(await auditRows()).toHaveLength(1);
    });

    it("the audit insert fails on sign-out: 500, the session stays live (the access cookie still works)", async () => {
      const { sessionA, cookie } = await signedInTwice();
      jest.spyOn(AdminAuditLogRepository.prototype, "create").mockRejectedValueOnce(new Error("audit insert refused (test)"));

      const failed = await http.call("POST", "/admin/auth/sign-out", { cookie });

      expect(failed.statusCode).toBe(500);
      expect(await revokedAt(sessionA.id)).toBeNull();
      expect((await http.call("GET", "/admin/auth/sessions", { cookie })).statusCode).toBe(200);
      expect(await auditRows()).toEqual([]);
    });

    it("an audited handler that records no change: 500 and its write is rolled back", async () => {
      const { adminId, cookie } = await startedSession("operations");

      const res = await http.call("POST", "/admin/audit-probe/forgets-record", { cookie });

      expect(res.statusCode).toBe(500);
      expect((await prisma.adminSession.findFirstOrThrow({ where: { adminId } })).revokedAt).toBeNull();
      expect(await auditRows()).toEqual([]);
    });
  });

  describe("RNX-167: a failed audited request sends no Set-Cookie", () => {
    /** The access cookie a browser holds after `res`: the one `res` set, else the one it already had. */
    const heldAccessCookie = (held: string, res: Awaited<ReturnType<typeof revoke>>) =>
      setCookies(res).some((cookie) => cookie.startsWith(`${ACCESS}=`)) ? accessCookie(res) : held;

    it("AC1: the audit insert fails on sign-out: 500, no Set-Cookie, the session stays live", async () => {
      const { sessionA, cookie } = await signedInTwice();
      jest.spyOn(AdminAuditLogRepository.prototype, "create").mockRejectedValueOnce(new Error("audit insert refused (test)"));

      const failed = await http.call("POST", "/admin/auth/sign-out", { cookie });

      expect(failed.statusCode).toBe(500);
      expect(failed.headers["set-cookie"]).toBeUndefined();
      expect(await revokedAt(sessionA.id)).toBeNull();
    });

    it("AC2: the audit insert fails on totp/confirm: no Set-Cookie; a retry with the enrolment cookie the browser holds succeeds", async () => {
      const admin = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
      const enrolmentCookie = accessCookie(await http.signIn({ email: admin.email, password: ADMIN_PASSWORD }));
      const { secret } = (await http.call("POST", "/admin/auth/totp/enrol", { cookie: enrolmentCookie })).json();
      jest.spyOn(AdminAuditLogRepository.prototype, "create").mockRejectedValueOnce(new Error("audit insert refused (test)"));

      const failed = await http.call("POST", "/admin/auth/totp/confirm", { cookie: enrolmentCookie }, { code: totpCode(secret) });
      nextStep();
      const retried = await http.call("POST", "/admin/auth/totp/confirm", { cookie: heldAccessCookie(enrolmentCookie, failed) }, { code: totpCode(secret) });

      expect(failed.statusCode).toBe(500);
      expect(retried.statusCode).toBe(200);
      expect(failed.headers["set-cookie"]).toBeUndefined();
      expect(accessCookie(retried)).not.toBe(enrolmentCookie);
      expect((await auditRows()).map((row) => row.action)).toEqual(["enrol", "confirm"]);
    });

    it("the handler fails after setting a cookie: 500 and no Set-Cookie", async () => {
      const { cookie } = await startedSession("operations");

      const res = await http.call("POST", "/admin/audit-probe/cookie-then-fail", { cookie });

      expect(res.statusCode).toBe(500);
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("AC3: a successful sign-out still clears the access and refresh cookies", async () => {
      const { cookie } = await signedInTwice();

      const res = await http.call("POST", "/admin/auth/sign-out", { cookie });

      expect(res.statusCode).toBe(204);
      expect(setCookies(res)).toEqual([
        expect.stringMatching(new RegExp(`^${ACCESS}=; Path=/; .*Max-Age=0$`)),
        expect.stringMatching(/^rx_admin_refresh=; Path=\/api\/v1\/admin\/auth\/refresh; .*Max-Age=0$/),
      ]);
    });
  });

  describe("AC6: a personal-data reveal (probe route)", () => {
    it("an allowed admin (Operations) with a reason: 200 and one row naming the admin, the user, the reason and the time", async () => {
      const user = await createUser(prisma, { email: USER_EMAIL });
      const { adminId, cookie } = await startedSession("operations");

      const res = await revealPii(cookie, user.id, { reason: REVEAL_REASON });

      expect(res.statusCode).toBe(200);
      expect(await auditRows()).toEqual([
        {
          id: expect.any(String),
          adminId,
          resource: "user_pii",
          action: "reveal",
          before: { userId: user.id, revealed: false },
          after: { userId: user.id, revealed: true },
          reason: REVEAL_REASON,
          requestId: expect.stringMatching(UUID_PATTERN),
          effectiveAt: new Date(Date.now()),
          createdAt: expect.any(Date),
        },
      ]);
    });

    it.each(["viewer", "finance", "support"])("a refused admin (%s, no grant): 403 and no row", async (role) => {
      const user = await createUser(prisma, { email: USER_EMAIL });
      const { cookie } = await startedSession(role);

      const res = await revealPii(cookie, user.id, { reason: REVEAL_REASON });

      expect(res.statusCode).toBe(403);
      expect(await auditRows()).toEqual([]);
    });

    it.each([
      ["no reason", {}],
      ["an empty reason", { reason: "" }],
      ["a blank reason", { reason: "   " }],
      ["a reason that is not text", { reason: 42 }],
      ["a reason over 500 characters", { reason: "x".repeat(501) }],
    ])("an allowed admin with %s: 400 and no row", async (_case, payload) => {
      const user = await createUser(prisma, { email: USER_EMAIL });
      const { cookie } = await startedSession("owner");

      const res = await revealPii(cookie, user.id, payload);

      expect(res.statusCode).toBe(400);
      expect(await auditRows()).toEqual([]);
    });
  });

  describe("AC7: no personal data, token or secret in the logs", () => {
    it("sign-in, enrolment, revoke, a failed audit insert and a reveal log none of them (the capture does see the logged error)", async () => {
      const user = await createUser(prisma, { email: USER_EMAIL });
      const secrets: string[] = [ADMIN_PASSWORD, USER_EMAIL, REVEAL_REASON];

      const logs = await captureLogs(async () => {
        const newcomer = await createAdmin(prisma, moduleRef, { email: "new@example.com" });
        const enrolmentCookie = accessCookie(await http.signIn({ email: newcomer.email, password: ADMIN_PASSWORD }));
        const { secret } = (await http.call("POST", "/admin/auth/totp/enrol", { cookie: enrolmentCookie })).json();
        const confirm = await http.call("POST", "/admin/auth/totp/confirm", { cookie: enrolmentCookie }, { code: totpCode(secret) });
        const { admin, first, second, sessionB, cookie } = await signedInTwice();
        secrets.push(secret, ...confirm.json().recoveryCodes, admin.secret);
        secrets.push(...[confirm, first, second].flatMap((res) => [accessCookie(res), refreshCookie(res)].map((value) => value.split("=")[1])));
        jest.spyOn(AdminAuditLogRepository.prototype, "create").mockRejectedValueOnce(new Error("audit insert refused (test)"));
        expect((await revoke(cookie, sessionB.id)).statusCode).toBe(500);
        expect((await revoke(cookie, sessionB.id)).statusCode).toBe(204);
        expect((await revealPii(cookie, user.id, { reason: REVEAL_REASON })).statusCode).toBe(200);
        expect((await revealPii(cookie, user.id, { reason: "" })).statusCode).toBe(400);
      });
      const stored = await prisma.adminUser.findMany();
      secrets.push(...stored.flatMap((row) => [row.passwordHash, row.totpSecretEncrypted ?? ""]).filter(Boolean));

      expect(logs).toContain("audit insert refused (test)");
      for (const value of secrets) expect(logs).not.toContain(value);
    });
  });
});
