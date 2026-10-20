import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { AdminAuthModule } from "../admin-auth.module";
import { AdminInvitationRepository } from "../repository/admin-invitation.repository";
import { AdminUserRepository } from "../repository/admin-user.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  accessCookie,
  advance,
  ADMIN_PASSWORD,
  adminHttp,
  BackOfficeProbeController,
  createAdmin,
  MINUTE,
  nextStep,
  refreshCookie,
  totpCode,
  useFakeDate,
} from "../../../../test/admin-auth";

// RNX-95 through real HTTP (Fastify `inject`), the real AccessGuard, audit hook and PrismaService on the test
// database: invitations, their completion, the admin list, suspension, MFA and forced password resets, the
// 2-minute re-authentication of the sensitive actions, and "me". Obviously fake values only.

const NEW_PASSWORD = "Vr7!kQp2#Lm9-rnx95-new";
const INVITEE = "invitee@example.com";
const HOUR = 60 * MINUTE;

type Admin = { id: string; email: string; secret: string };

describe("Admin management (RNX-95, Fastify, test database)", () => {
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

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => app?.close());

  const enrolledAdmin = (email: string, role = "operations") => createAdmin(prisma, moduleRef, { email, enrolled: true, role });
  const signIn = async (admin: Admin): Promise<string> => {
    nextStep();
    const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    expect(res.statusCode).toBe(200);
    return accessCookie(res);
  };
  const reauth = async (cookie: string, admin: Admin) => {
    nextStep();
    const res = await http.call("POST", "/admin/auth/reauth", { cookie }, { password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
    expect(res.statusCode).toBe(204);
  };
  /** An Owner signed in and re-authenticated. */
  const ownerSession = async (email = "owner@example.com") => {
    const owner = await enrolledAdmin(email, "owner");
    const cookie = await signIn(owner);
    await reauth(cookie, owner);
    return { owner, cookie };
  };
  const invite = (cookie: string, email = INVITEE, role = "support") =>
    http.call("POST", "/admin/invitations", { cookie }, { email, role });
  const tokenOf = (link: string): string => new URL(link).hash.replace("#token=", "");
  const accept = (token: string, name = "New Admin", password = NEW_PASSWORD) =>
    http.call("POST", "/admin/invitations/accept", {}, { token, name, password });
  const adminsWithEmail = (email: string) => prisma.adminUser.count({ where: { email } });
  const pendingFor = (email: string) => prisma.adminInvitation.count({ where: { email, usedAt: null, revokedAt: null } });

  /**
   * Holds every caller of `method` until `callers` have arrived (docs/testing.md, race tests): all of them pass
   * the checks before it on the same state before any of them writes.
   */
  const holdCallers = <T extends object>(target: T, method: keyof T & string, callers: number) => {
    const original = (target[method] as (...args: unknown[]) => unknown).bind(target);
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolveAll) => (releaseAll = resolveAll));
    jest.spyOn(target, method as never).mockImplementation((async (...args: unknown[]) => {
      arrived += 1;
      if (arrived === callers) releaseAll();
      await allArrived;
      return original(...args);
    }) as never);
  };

  describe("completing an invitation", () => {
    it("preview shows who invited and the role; accept creates the admin with the invitation's email, then TOTP enrolment issues recovery codes", async () => {
      const { owner, cookie } = await ownerSession();
      const invitedAt = Date.now();
      const created = await invite(cookie);
      const token = tokenOf(created.json().link);

      const preview = await http.call("POST", "/admin/invitations/preview", {}, { token });
      const accepted = await accept(token, "Ina Vitee");
      const enrolmentCookie = accessCookie(accepted);
      const enrol = await http.call("POST", "/admin/auth/totp/enrol", { cookie: enrolmentCookie });
      nextStep();
      const confirm = await http.call("POST", "/admin/auth/totp/confirm", { cookie: enrolmentCookie }, { code: totpCode(enrol.json().secret) });

      expect([created.statusCode, preview.statusCode, accepted.statusCode, enrol.statusCode, confirm.statusCode]).toEqual([201, 200, 200, 200, 200]);
      expect(preview.json()).toEqual({
        email: INVITEE,
        role: "support",
        invitedBy: { name: null, email: owner.email },
        expiresAt: new Date(invitedAt + 72 * HOUR).toISOString(),
      });
      expect(accepted.json()).toEqual({ scope: "enrolment" });
      expect(confirm.json().recoveryCodes).toHaveLength(10);
      expect(await prisma.adminUser.findUniqueOrThrow({ where: { email: INVITEE } })).toMatchObject({ name: "Ina Vitee", role: "support" });
      expect(await prisma.adminAuditLog.count({ where: { resource: "admin_invitation", action: "accept" } })).toBe(1);
    });

    it("the email cannot be changed: an email in the accept body is ignored, the admin gets the invitation's email", async () => {
      const { cookie } = await ownerSession();
      const token = tokenOf((await invite(cookie)).json().link);

      const res = await http.call("POST", "/admin/invitations/accept", {}, { token, name: "X", password: NEW_PASSWORD, email: "other@example.com" });

      expect(res.statusCode).toBe(200);
      expect(await adminsWithEmail("other@example.com")).toBe(0);
      expect(await adminsWithEmail(INVITEE)).toBe(1);
    });
  });

  describe("criterion 1: a used, revoked or expired link errors and creates nothing", () => {
    it("used: 410, no second admin, no new session", async () => {
      const { cookie } = await ownerSession();
      const token = tokenOf((await invite(cookie)).json().link);
      expect((await accept(token)).statusCode).toBe(200);
      const sessionsBefore = await prisma.adminSession.count();

      const again = await accept(token, "Someone Else");

      expect(again.statusCode).toBe(410);
      expect(again.json().message).toBe("This invitation link has already been used");
      expect(await adminsWithEmail(INVITEE)).toBe(1);
      expect(await prisma.adminSession.count()).toBe(sessionsBefore);
    });

    it("revoked: 410, no admin row", async () => {
      const { cookie } = await ownerSession();
      const created = (await invite(cookie)).json();
      expect((await http.call("DELETE", `/admin/invitations/${created.invitation.id}`, { cookie })).statusCode).toBe(204);

      const res = await accept(tokenOf(created.link));

      expect(res.statusCode).toBe(410);
      expect(res.json().message).toBe("This invitation link has been revoked");
      expect(await adminsWithEmail(INVITEE)).toBe(0);
    });

    it("expired (72 hours): 410 on preview and accept, no admin row", async () => {
      const { cookie } = await ownerSession();
      const token = tokenOf((await invite(cookie)).json().link);
      advance(72 * HOUR + 1_000);

      const preview = await http.call("POST", "/admin/invitations/preview", {}, { token });
      const res = await accept(token);

      expect([preview.statusCode, res.statusCode]).toEqual([410, 410]);
      expect(res.json().message).toBe("This invitation link has expired");
      expect(await adminsWithEmail(INVITEE)).toBe(0);
    });

    it("an unknown token: 404, nothing created", async () => {
      const res = await accept("not-a-real-token");

      expect(res.statusCode).toBe(404);
      expect(await prisma.adminUser.count()).toBe(0);
    });

    it("two completions of one link at the same moment: one 200, one 410, one admin, one session", async () => {
      const { cookie } = await ownerSession();
      const token = tokenOf((await invite(cookie)).json().link);
      const sessionsBefore = await prisma.adminSession.count();
      holdCallers(moduleRef.get(AdminInvitationRepository), "findByTokenHash", 2);

      const results = await Promise.all([accept(token, "First"), accept(token, "Second")]);

      expect(results.map((res) => res.statusCode).sort()).toEqual([200, 410]);
      expect(await adminsWithEmail(INVITEE)).toBe(1);
      expect(await prisma.adminSession.count()).toBe(sessionsBefore + 1);
    });
  });

  describe("criterion 2: a suspended admin is refused at sign-in, refresh and the access check", () => {
    const suspendInDatabase = (adminId: string) => prisma.adminUser.update({ where: { id: adminId }, data: { suspendedAt: new Date() } });

    it("sign-in: 401 with the generic body (control: 200 before)", async () => {
      const admin = await enrolledAdmin("ops@example.com");
      await signIn(admin);
      await suspendInDatabase(admin.id);
      nextStep();

      const res = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });

      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe("Invalid credentials");
    });

    it("refresh: 401 and the session is revoked, though the session itself was still live", async () => {
      const admin = await enrolledAdmin("ops@example.com");
      nextStep();
      const signedIn = await http.signIn({ email: admin.email, password: ADMIN_PASSWORD, totp: totpCode(admin.secret) });
      await suspendInDatabase(admin.id);

      const res = await http.refresh(refreshCookie(signedIn));

      expect(res.statusCode).toBe(401);
      expect((await prisma.adminSession.findFirstOrThrow({ where: { adminId: admin.id } })).revokedAt).not.toBeNull();
    });

    it("any staff route: 401 with a live session (control: 200 before)", async () => {
      const admin = await enrolledAdmin("ops@example.com");
      const cookie = await signIn(admin);
      const before = await http.call("GET", "/admin/probe", { cookie });
      await suspendInDatabase(admin.id);

      const after = await http.call("GET", "/admin/probe", { cookie });

      expect([before.statusCode, after.statusCode]).toEqual([200, 401]);
    });
  });

  describe("criterion 3: the raw token is only in the one create response", () => {
    it("not in logs, audit rows, any database column, the list or the preview", async () => {
      const logged: string[] = [];
      for (const level of ["log", "warn", "error", "debug", "verbose", "fatal"] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
      }
      const { cookie } = await ownerSession();
      const created = await invite(cookie);
      const { invitation, link } = created.json();
      const token = tokenOf(link);
      const list = await http.call("GET", "/admin/admins", { cookie });
      const preview = await http.call("POST", "/admin/invitations/preview", {}, { token });
      const auditRows = await prisma.adminAuditLog.findMany();
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
      const rows = await Promise.all(
        tables.map(({ table_name }) => prisma.$queryRawUnsafe<{ row: string }[]>(`SELECT row_to_json(t)::text AS row FROM "${table_name}" t`)),
      );

      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(created.body).toContain(token);
      expect(logged.join("\n")).toContain(invitation.id);
      expect(logged.join("\n")).not.toContain(token);
      expect(auditRows.some((row) => JSON.stringify(row.after).includes(invitation.id))).toBe(true);
      expect(JSON.stringify(auditRows)).not.toContain(token);
      expect(rows.flat().map((r) => r.row).join("\n")).toContain(invitation.id);
      expect(rows.flat().map((r) => r.row).join("\n")).not.toContain(token);
      expect(list.body).toContain(invitation.id);
      expect(list.body).not.toContain(token);
      expect(preview.statusCode).toBe(200);
      expect(preview.body).not.toContain(token);
    });
  });

  describe("criterion 4: resend, one pending invitation per email, existing admins", () => {
    it("resend: the old link fails, the new one works", async () => {
      const { cookie } = await ownerSession();
      const created = (await invite(cookie)).json();
      const resent = await http.call("POST", `/admin/invitations/${created.invitation.id}/resend`, { cookie });

      const old = await accept(tokenOf(created.link));
      const fresh = await accept(tokenOf(resent.json().link));

      expect([resent.statusCode, old.statusCode, fresh.statusCode]).toEqual([200, 410, 200]);
      expect(resent.json().link).not.toBe(created.link);
      expect(await adminsWithEmail(INVITEE)).toBe(1);
    });

    it("resend gives a fresh 72 hours", async () => {
      const { owner, cookie } = await ownerSession();
      const created = (await invite(cookie)).json();
      advance(71 * HOUR);
      const resent = await http.call("POST", `/admin/invitations/${created.invitation.id}/resend`, { cookie: await signIn(owner) });
      advance(2 * HOUR);

      expect(resent.statusCode).toBe(200);
      expect((await accept(tokenOf(resent.json().link))).statusCode).toBe(200);
    });

    it("a second invite for the same email: 409, still one pending invitation", async () => {
      const { cookie } = await ownerSession();
      await invite(cookie);

      const second = await invite(cookie, INVITEE.toUpperCase(), "viewer");

      expect(second.statusCode).toBe(409);
      expect(await pendingFor(INVITEE)).toBe(1);
    });

    it("two invites of one email at the same moment: one 201, one 409, one pending invitation", async () => {
      const { cookie } = await ownerSession();
      holdCallers(moduleRef.get(AdminUserRepository), "findByEmail", 2);

      const results = await Promise.all([invite(cookie), invite(cookie, INVITEE, "viewer")]);

      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
      expect(await pendingFor(INVITEE)).toBe(1);
    });

    it("the email of an existing admin: 409, no invitation", async () => {
      const { cookie } = await ownerSession();
      await enrolledAdmin("ops@example.com");

      const res = await invite(cookie, "ops@example.com");

      expect(res.statusCode).toBe(409);
      expect(await prisma.adminInvitation.count()).toBe(0);
    });
  });

  describe("criterion 5: the admin list", () => {
    it("a pending invitation has no admin row and is listed as invited, next to active and suspended admins", async () => {
      const { owner, cookie } = await ownerSession();
      const ops = await enrolledAdmin("ops@example.com");
      await prisma.adminUser.update({ where: { id: ops.id }, data: { suspendedAt: new Date() } });
      const created = (await invite(cookie)).json();

      const res = await http.call("GET", "/admin/admins", { cookie });

      expect(await adminsWithEmail(INVITEE)).toBe(0);
      expect(res.statusCode).toBe(200);
      expect(res.json().admins).toEqual([
        expect.objectContaining({ id: owner.id, email: owner.email, role: "owner", status: "active", mfa: "enrolled", lastSignInAt: expect.any(String) }),
        expect.objectContaining({ id: ops.id, status: "suspended", mfa: "enrolled", lastSignInAt: null }),
        { id: created.invitation.id, status: "invited", name: null, email: INVITEE, role: "support", mfa: "not_enrolled", lastSignInAt: null, invitationExpiresAt: created.invitation.expiresAt },
      ]);
    });
  });

  describe("criterion 6: a non-Owner (re-authenticated) gets 403 and changes nothing", () => {
    it.each([
      ["invites", (target: Admin) => ["/admin/invitations", { email: `x-${target.id}@example.com`, role: "viewer" }] as const],
      ["suspends", (target: Admin) => [`/admin/admins/${target.id}/suspend`, undefined] as const],
      ["resets MFA", (target: Admin) => [`/admin/admins/${target.id}/reset-mfa`, undefined] as const],
      ["forces a password reset", (target: Admin) => [`/admin/admins/${target.id}/force-password-reset`, undefined] as const],
    ])("%s: 403", async (_case, route) => {
      const ops = await enrolledAdmin("ops@example.com");
      const target = await enrolledAdmin("fin@example.com", "finance");
      const cookie = await signIn(ops);
      await reauth(cookie, ops);
      const [url, body] = route(target);

      const res = await http.call("POST", url, { cookie }, body);

      expect(res.statusCode).toBe(403);
      expect(res.json().message).not.toBe("Re-authentication required");
      expect(await prisma.adminInvitation.count()).toBe(0);
      expect(await prisma.adminUser.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        suspendedAt: null,
        mustChangePassword: false,
        totpEnrolledAt: expect.any(Date),
      });
    });
  });

  describe("criterion 7: the last active owner and oneself", () => {
    /** An admin of a custom role that holds admins:write (RNX-187 will make these): not an owner. */
    const customManagerSession = async () => {
      await prisma.adminRole.create({ data: { name: "admin_manager", permissions: ["admins:read", "admins:write"] } });
      const manager = await enrolledAdmin("manager@example.com", "admin_manager");
      const cookie = await signIn(manager);
      await reauth(cookie, manager);
      return cookie;
    };

    it("the last active owner (the other owner suspended) cannot be suspended: 409", async () => {
      const lastOwner = await enrolledAdmin("owner@example.com", "owner");
      const suspendedOwner = await enrolledAdmin("owner2@example.com", "owner");
      await prisma.adminUser.update({ where: { id: suspendedOwner.id }, data: { suspendedAt: new Date() } });
      const cookie = await customManagerSession();

      const res = await http.call("POST", `/admin/admins/${lastOwner.id}/suspend`, { cookie });

      expect(res.statusCode).toBe(409);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: lastOwner.id } })).suspendedAt).toBeNull();
    });

    it("control: with a second active owner, the same suspension succeeds", async () => {
      const owner = await enrolledAdmin("owner@example.com", "owner");
      await enrolledAdmin("owner2@example.com", "owner");
      const cookie = await customManagerSession();

      const res = await http.call("POST", `/admin/admins/${owner.id}/suspend`, { cookie });

      expect(res.statusCode).toBe(204);
    });

    it("an Owner cannot suspend themselves: 403, still active", async () => {
      const { owner, cookie } = await ownerSession();
      await enrolledAdmin("owner2@example.com", "owner");

      const res = await http.call("POST", `/admin/admins/${owner.id}/suspend`, { cookie });

      expect(res.statusCode).toBe(403);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: owner.id } })).suspendedAt).toBeNull();
    });
  });

  describe("criterion 8: a forced password reset", () => {
    it("ends the sessions; after sign-in only change-password works (403 elsewhere) until it is changed, then everything works", async () => {
      const { cookie: ownerCookie } = await ownerSession();
      const ops = await enrolledAdmin("ops@example.com");
      const oldCookie = await signIn(ops);

      const force = await http.call("POST", `/admin/admins/${ops.id}/force-password-reset`, { cookie: ownerCookie });
      const oldSession = await http.call("GET", "/admin/probe", { cookie: oldCookie });
      const restricted = await signIn(ops);
      const me = await http.call("GET", "/admin/auth/me", { cookie: restricted });
      const blocked = await Promise.all([
        http.call("GET", "/admin/probe", { cookie: restricted }),
        http.call("GET", "/admin/auth/sessions", { cookie: restricted }),
        http.call("POST", "/admin/auth/reauth", { cookie: restricted }, { password: ADMIN_PASSWORD, totp: "000000" }),
        http.call("GET", "/admin/audit-log", { cookie: restricted }),
      ]);
      const changed = await http.call("POST", "/admin/auth/password", { cookie: restricted }, { newPassword: NEW_PASSWORD });
      const restrictedAfter = await http.call("GET", "/admin/probe", { cookie: restricted });
      const full = await http.call("GET", "/admin/probe", { cookie: accessCookie(changed) });
      nextStep();
      const signInAgain = await http.signIn({ email: ops.email, password: NEW_PASSWORD, totp: totpCode(ops.secret) });

      expect([force.statusCode, oldSession.statusCode]).toEqual([204, 401]);
      expect(me.json()).toMatchObject({ id: ops.id, scope: "password_change", mustChangePassword: true });
      expect(blocked.map((res) => res.statusCode)).toEqual([403, 403, 403, 403]);
      expect([changed.statusCode, restrictedAfter.statusCode, full.statusCode]).toEqual([200, 401, 200]);
      expect(changed.json()).toEqual({ scope: "full" });
      expect(signInAgain.json()).toEqual({ scope: "full" });
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: ops.id } })).mustChangePassword).toBe(false);
    });

    it("control: without a forced reset, sign-in gives a full session and change-password answers 403", async () => {
      const ops = await enrolledAdmin("ops@example.com");
      const cookie = await signIn(ops);

      const res = await http.call("POST", "/admin/auth/password", { cookie }, { newPassword: NEW_PASSWORD });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("criterion 9: the sensitive actions need a re-authentication within 2 minutes", () => {
    it.each([
      ["suspend", "suspend"],
      ["reset MFA", "reset-mfa"],
      ["force a password reset", "force-password-reset"],
    ])("%s: 403 without re-auth and 2 minutes after it; 204 within 2 minutes", async (_case, action) => {
      const owner = await enrolledAdmin("owner@example.com", "owner");
      const target = await enrolledAdmin("ops@example.com");
      const cookie = await signIn(owner);
      const url = `/admin/admins/${target.id}/${action}`;

      const never = await http.call("POST", url, { cookie });
      await reauth(cookie, owner);
      advance(2 * MINUTE + 1_000);
      const stale = await http.call("POST", url, { cookie });
      await reauth(cookie, owner);
      advance(2 * MINUTE - 30_000 - 1_000);
      const fresh = await http.call("POST", url, { cookie });

      expect([never.statusCode, stale.statusCode, fresh.statusCode]).toEqual([403, 403, 204]);
      expect([never.json().message, stale.json().message]).toEqual(["Re-authentication required", "Re-authentication required"]);
    });
  });

  describe("criterion 10: removing an admin is a suspension", () => {
    it("an admin who granted a PII grant: suspended, sessions ended, grant rows kept, no database error", async () => {
      const { cookie } = await ownerSession();
      const granter = await enrolledAdmin("granter@example.com", "support");
      const holder = await enrolledAdmin("holder@example.com", "support");
      await prisma.adminPiiGrant.create({
        data: { adminId: holder.id, subjectUserId: "subject-user", reason: "case 1", grantedByAdminId: granter.id, expiresAt: new Date(Date.now() + HOUR) },
      });
      const granterCookie = await signIn(granter);

      const res = await http.call("POST", `/admin/admins/${granter.id}/suspend`, { cookie });

      expect(res.statusCode).toBe(204);
      expect((await prisma.adminUser.findUniqueOrThrow({ where: { id: granter.id } })).suspendedAt).not.toBeNull();
      expect(await prisma.adminSession.count({ where: { adminId: granter.id, revokedAt: null } })).toBe(0);
      expect((await http.call("GET", "/admin/probe", { cookie: granterCookie })).statusCode).toBe(401);
      expect(await prisma.adminPiiGrant.count({ where: { grantedByAdminId: granter.id } })).toBe(1);
      expect(await prisma.adminAuditLog.count({ where: { resource: "admin_user", action: "suspend" } })).toBe(1);
    });

    it("reactivate lifts the suspension; sign-in works again", async () => {
      const { cookie } = await ownerSession();
      const ops = await enrolledAdmin("ops@example.com");
      await http.call("POST", `/admin/admins/${ops.id}/suspend`, { cookie });

      const res = await http.call("POST", `/admin/admins/${ops.id}/reactivate`, { cookie });

      expect(res.statusCode).toBe(204);
      await signIn(ops);
    });

    it("no source file of the API deletes an admin_users row", () => {
      const root = resolve(__dirname, "../../..");
      const sources = listSources(root);
      const deleting = sources.filter((file) => /adminUser\s*\.\s*delete(Many)?\b|DELETE\s+FROM\s+"?admin_users"?/i.test(readFileSync(file, "utf8")));

      expect(sources.length).toBeGreaterThan(100);
      expect(deleting).toEqual([]);
    });
  });

  describe("MFA reset", () => {
    it("removes TOTP and recovery codes and ends the sessions: the next sign-in gives an enrolment session", async () => {
      const { cookie } = await ownerSession();
      const ops = await enrolledAdmin("ops@example.com");
      await prisma.adminRecoveryCode.create({ data: { adminId: ops.id, codeHash: "hash-of-a-fake-code" } });
      const opsCookie = await signIn(ops);

      const res = await http.call("POST", `/admin/admins/${ops.id}/reset-mfa`, { cookie });
      const signedIn = await http.signIn({ email: ops.email, password: ADMIN_PASSWORD });

      expect(res.statusCode).toBe(204);
      expect((await http.call("GET", "/admin/probe", { cookie: opsCookie })).statusCode).toBe(401);
      expect(await prisma.adminRecoveryCode.count({ where: { adminId: ops.id } })).toBe(0);
      expect(signedIn.json()).toEqual({ scope: "enrolment" });
    });
  });

  describe("GET /admin/auth/me", () => {
    it("the admin, role, permissions and the forced-reset flag", async () => {
      const ops = await enrolledAdmin("ops@example.com");
      const cookie = await signIn(ops);

      const res = await http.call("GET", "/admin/auth/me", { cookie });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: ops.id, email: ops.email, role: "operations", scope: "full", mfaEnrolled: true, mustChangePassword: false });
      expect(res.json().permissions).toContain("users:read");
    });
  });
});

/** Every non-spec TypeScript file under `dir`, the generated Prisma client left out. */
function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : listSources(path);
    return name.endsWith(".ts") && !name.endsWith(".spec.ts") ? [path] : [];
  });
}
