import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../admin-auth.module";
import { AdminUserRepository } from "../repository/admin-user.repository";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import {
  accessCookie,
  advance,
  ADMIN_PASSWORD,
  adminHttp,
  BACK_OFFICE_ORIGIN,
  createAdmin,
  MINUTE,
  nextStep,
  totpCode,
  useFakeDate,
} from "../../../../test/admin-auth";

// RNX-187 through real HTTP (Fastify `inject`), the real AccessGuard, audit hook and PrismaService on the test
// database: the role list, custom roles, role assignment, the built-in roles fixed in code, no escalation, no
// self change, the last active owner, and the 2-minute re-authentication of Owner changes, role edits and
// Owner invitations. Obviously fake values only.

type Admin = { id: string; email: string; secret: string };

const BUILT_IN = ["owner", "operations", "finance", "support", "viewer"];
const REAUTH_REQUIRED = "Re-authentication required";

describe("Roles API (RNX-187, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof adminHttp>;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule] }));
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
  /** An admin of this role, signed in and re-authenticated. */
  const reauthedSession = async (email: string, role: string) => {
    const admin = await enrolledAdmin(email, role);
    const cookie = await signIn(admin);
    await reauth(cookie, admin);
    return { admin, cookie };
  };
  const send = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  const createRole = (cookie: string, name: string, permissions: string[]) => send("POST", "/admin/roles", cookie, { name, permissions });
  const editRole = (cookie: string, name: string, body: object) => send("PATCH", `/admin/roles/${name}`, cookie, body);
  const assign = (cookie: string, adminId: string, role: string) => send("PUT", `/admin/admins/${adminId}/role`, cookie, { role });
  const invite = (cookie: string, role: string, email = "invitee@example.com") =>
    http.call("POST", "/admin/invitations", { cookie }, { email, role });
  const roleOf = async (adminId: string) => (await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } })).role;
  const rolesTable = () => prisma.adminRole.findMany({ select: { name: true, permissions: true }, orderBy: { name: "asc" } });
  const adminRoles = () => prisma.adminUser.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } });
  const auditRows = (resource: string, action: string) => prisma.adminAuditLog.findMany({ where: { resource, action } });

  describe("criterion 1: custom roles and assignment", () => {
    it("an Owner creates a custom role and assigns it: the admin holding it gets exactly those permissions on their next request", async () => {
      const staff = await enrolledAdmin("staff@example.com", "support");
      const staffCookie = await signIn(staff);
      const before = await Promise.all(["/admin/audit-log", "/admin/roles"].map((url) => send("GET", url, staffCookie)));
      const { admin: owner, cookie } = await reauthedSession("owner@example.com", "owner");

      const created = await createRole(cookie, "auditor", ["audit:read", "roles:read"]);
      const assigned = await assign(cookie, staff.id, "auditor");
      const after = await Promise.all(["/admin/audit-log", "/admin/roles", "/admin/admins"].map((url) => send("GET", url, staffCookie)));

      expect(before.map((res) => res.statusCode)).toEqual([403, 403]);
      expect([created.statusCode, assigned.statusCode]).toEqual([204, 204]);
      expect(after.map((res) => res.statusCode)).toEqual([200, 200, 403]);
      expect(after[1].json().roles).toContainEqual({ name: "auditor", builtIn: false, permissions: ["audit:read", "roles:read"] });
      expect(after[1].json().roles).toContainEqual(expect.objectContaining({ name: "owner", builtIn: true }));
      const [createRow] = await auditRows("admin_role", "create");
      const [assignRow] = await auditRows("admin_user", "assign_role");
      expect(createRow).toMatchObject({ adminId: owner.id, before: { name: null, permissions: null }, after: { name: "auditor", permissions: "audit:read,roles:read" } });
      expect(assignRow).toMatchObject({ adminId: owner.id, before: { adminId: staff.id, role: "support" }, after: { adminId: staff.id, role: "auditor" } });
    });

    it.each(["operations", "finance", "support", "viewer", "custom"])(
      "a non-Owner (%s, re-authenticated): every roles write and every role assignment gets 403, nothing changes",
      async (role) => {
        await enrolledAdmin("seed@example.com", "viewer");
        await prisma.adminRole.create({ data: { name: "custom", permissions: ["users:read", "admins:read", "roles:read"] } });
        await prisma.adminRole.create({ data: { name: "spare", permissions: ["users:read"] } });
        const target = await enrolledAdmin("target@example.com", "viewer");
        const { cookie } = await reauthedSession("actor@example.com", role);
        const rolesBefore = await rolesTable();
        const adminsBefore = await adminRoles();

        const responses = await Promise.all([
          createRole(cookie, "made-up", ["users:read"]),
          editRole(cookie, "spare", { permissions: ["usage:read"] }),
          editRole(cookie, "spare", { name: "renamed" }),
          send("DELETE", "/admin/roles/spare", cookie),
          assign(cookie, target.id, "owner"),
          assign(cookie, target.id, "spare"),
        ]);

        expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 403, 403, 403, 403]);
        expect(await rolesTable()).toEqual(rolesBefore);
        expect(await adminRoles()).toEqual(adminsBefore);
        expect(await prisma.adminAuditLog.count({ where: { resource: { in: ["admin_role", "admin_user"] } } })).toBe(0);
      },
    );

    it("an Owner edits a custom role: its admins get the new permissions on their next request; a rename keeps them on it", async () => {
      await enrolledAdmin("seed@example.com", "viewer");
      await prisma.adminRole.create({ data: { name: "auditor", permissions: ["users:read"] } });
      const staff = await enrolledAdmin("staff@example.com", "auditor");
      const staffCookie = await signIn(staff);
      const before = await send("GET", "/admin/audit-log", staffCookie);
      const { cookie } = await reauthedSession("owner@example.com", "owner");

      const edited = await editRole(cookie, "auditor", { name: "log-reader", permissions: ["audit:read"] });
      const after = await send("GET", "/admin/audit-log", staffCookie);

      expect([before.statusCode, edited.statusCode, after.statusCode]).toEqual([403, 204, 200]);
      expect(await roleOf(staff.id)).toBe("log-reader");
      expect(await prisma.adminRole.findUnique({ where: { name: "auditor" } })).toBeNull();
      expect(await auditRows("admin_role", "update")).toEqual([
        expect.objectContaining({ before: { name: "auditor", permissions: "users:read" }, after: { name: "log-reader", permissions: "audit:read" } }),
      ]);
    });

    it("an Owner deletes a custom role nobody holds (204); one an admin holds: 409, kept", async () => {
      const { cookie } = await reauthedSession("owner@example.com", "owner");
      await prisma.adminRole.createMany({ data: [{ name: "unused" }, { name: "held" }] });
      await enrolledAdmin("held@example.com", "held");

      const unused = await send("DELETE", "/admin/roles/unused", cookie);
      const held = await send("DELETE", "/admin/roles/held", cookie);

      expect([unused.statusCode, held.statusCode]).toEqual([204, 409]);
      expect((await rolesTable()).map((role) => role.name)).toEqual(expect.arrayContaining(["held"]));
      expect(await prisma.adminRole.findUnique({ where: { name: "unused" } })).toBeNull();
      expect(await auditRows("admin_role", "delete")).toHaveLength(1);
    });
  });

  describe("criterion 2: built-in roles cannot be deleted; the last active owner remains", () => {
    it.each(BUILT_IN)("deleting the built-in role %s: 403, the role and its admins stay", async (name) => {
      const { cookie } = await reauthedSession("owner@example.com", "owner");
      const rolesBefore = await rolesTable();
      const adminsBefore = await adminRoles();

      const res = await send("DELETE", `/admin/roles/${name}`, cookie);

      expect(res.statusCode).toBe(403);
      expect(await rolesTable()).toEqual(rolesBefore);
      expect(await adminRoles()).toEqual(adminsBefore);
    });

    it("two Owners demoting each other at the same moment: one 204, one 409, one active owner remains", async () => {
      const first = await reauthedSession("a@example.com", "owner");
      const second = await reauthedSession("b@example.com", "owner");
      await reauth(first.cookie, first.admin);
      // docs/testing.md, race tests: both requests pass the access check and reach the owner lock before either writes.
      const repository = moduleRef.get(AdminUserRepository);
      const lockActiveIdsWithRole = repository.lockActiveIdsWithRole.bind(repository);
      let arrived = 0;
      let releaseAll!: () => void;
      const allArrived = new Promise<void>((resolveAll) => (releaseAll = resolveAll));
      jest.spyOn(repository, "lockActiveIdsWithRole").mockImplementation(async (...args) => {
        arrived += 1;
        if (arrived === 2) releaseAll();
        await allArrived;
        return lockActiveIdsWithRole(...args);
      });

      const responses = await Promise.all([assign(first.cookie, second.admin.id, "viewer"), assign(second.cookie, first.admin.id, "viewer")]);

      expect(responses.map((res) => res.statusCode).sort()).toEqual([204, 409]);
      expect(await prisma.adminUser.count({ where: { role: "owner", suspendedAt: null } })).toBe(1);
    });
  });

  describe("criterion 3: no self role change", () => {
    it("an Owner changing their own role through the route: 403, role unchanged", async () => {
      await enrolledAdmin("other-owner@example.com", "owner");
      const { admin, cookie } = await reauthedSession("owner@example.com", "owner");

      const res = await assign(cookie, admin.id, "viewer");

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("You cannot change your own role");
      expect(await roleOf(admin.id)).toBe("owner");
    });
  });

  describe("criterion 4: the built-in roles are fixed in code", () => {
    it.each(BUILT_IN.flatMap((name) => [
      [name, "rename", { name: `${name}-renamed` }],
      [name, "change the permissions of", { permissions: ["users:read"] }],
      [name, "rename and change", { name: `${name}-x`, permissions: [] }],
    ]))("%s: %s → 403, every admin keeps role and permissions", async (name, _action, body) => {
      const { cookie } = await reauthedSession("owner@example.com", "owner");
      await enrolledAdmin("member@example.com", name);
      const rolesBefore = await rolesTable();
      const adminsBefore = await adminRoles();

      const res = await editRole(cookie, name, body);

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("Built-in roles cannot be renamed, edited or deleted");
      expect(await rolesTable()).toEqual(rolesBefore);
      expect(await adminRoles()).toEqual(adminsBefore);
    });
  });

  describe("criterion 5: a custom role's permissions come from STAFF_PERMISSIONS, without the Owner-only ones", () => {
    const REFUSED: [string, string[]][] = [
      ["an unknown permission", ["users:delete_all"]],
      ["an unknown one next to a valid one", ["users:read", "users:delete_all"]],
      ["admins:write", ["admins:write"]],
      ["roles:write", ["roles:write"]],
      ["roles:write next to a valid one", ["users:read", "roles:write"]],
    ];

    it.each(REFUSED)("create with %s: 400, nothing stored", async (_case, permissions) => {
      const { cookie } = await reauthedSession("owner@example.com", "owner");
      const rolesBefore = await rolesTable();

      const res = await createRole(cookie, "escalator", permissions);

      expect(res.statusCode).toBe(400);
      expect(await rolesTable()).toEqual(rolesBefore);
    });

    it.each(REFUSED)("edit with %s: 400, nothing stored", async (_case, permissions) => {
      const { cookie } = await reauthedSession("owner@example.com", "owner");
      await prisma.adminRole.create({ data: { name: "helper", permissions: ["users:read"] } });
      const rolesBefore = await rolesTable();

      const res = await editRole(cookie, "helper", { permissions });

      expect(res.statusCode).toBe(400);
      expect(await rolesTable()).toEqual(rolesBefore);
    });

    it("control: only allowed permissions → created and edited as given", async () => {
      const { cookie } = await reauthedSession("owner@example.com", "owner");

      const created = await createRole(cookie, "helper", ["users:read", "admins:read", "roles:read"]);
      const edited = await editRole(cookie, "helper", { permissions: ["credits:read", "usage:read"] });

      expect([created.statusCode, edited.statusCode]).toEqual([204, 204]);
      expect(await prisma.adminRole.findUniqueOrThrow({ where: { name: "helper" } })).toMatchObject({
        builtIn: false,
        permissions: ["credits:read", "usage:read"],
      });
    });
  });

  describe("criterion 6: Owner changes, role edits and Owner invitations need a re-authentication within 2 minutes", () => {
    /** The response of `act` with no re-auth, one older than 2 minutes, and one within 2 minutes. */
    const windowResponses = async (admin: Admin, cookie: string, act: () => ReturnType<typeof send>) => {
      const never = await act();
      await reauth(cookie, admin);
      advance(2 * MINUTE + 1_000);
      const stale = await act();
      await reauth(cookie, admin);
      advance(2 * MINUTE - 30_000 - 1_000);
      const fresh = await act();
      return [never, stale, fresh];
    };

    it.each([
      ["assigning Owner", "operations", "owner"],
      ["removing Owner", "owner", "viewer"],
    ])("%s: 403 without re-auth and 2 minutes after it, role unchanged; 204 within 2 minutes", async (_case, from, to) => {
      const owner = await enrolledAdmin("owner@example.com", "owner");
      const target = await enrolledAdmin("target@example.com", from);
      const cookie = await signIn(owner);
      let roleAfterRefusals = "";

      const responses = await windowResponses(owner, cookie, async () => {
        const res = await assign(cookie, target.id, to);
        if (res.statusCode === 403) roleAfterRefusals = await roleOf(target.id);
        return res;
      });

      expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 204]);
      expect(responses.slice(0, 2).map((res) => res.json().message)).toEqual([REAUTH_REQUIRED, REAUTH_REQUIRED]);
      expect(roleAfterRefusals).toBe(from);
      expect(await roleOf(target.id)).toBe(to);
    });

    it("editing a role: 403 without re-auth and 2 minutes after it, nothing changed; 204 within 2 minutes", async () => {
      const owner = await enrolledAdmin("owner@example.com", "owner");
      await prisma.adminRole.create({ data: { name: "helper", permissions: ["users:read"] } });
      const cookie = await signIn(owner);
      let permissionsAfterRefusals: string[] = [];

      const responses = await windowResponses(owner, cookie, async () => {
        const res = await editRole(cookie, "helper", { permissions: ["usage:read"] });
        if (res.statusCode === 403) permissionsAfterRefusals = (await prisma.adminRole.findUniqueOrThrow({ where: { name: "helper" } })).permissions;
        return res;
      });

      expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 204]);
      expect(permissionsAfterRefusals).toEqual(["users:read"]);
      expect((await prisma.adminRole.findUniqueOrThrow({ where: { name: "helper" } })).permissions).toEqual(["usage:read"]);
    });

    it("inviting with role owner: 403 without re-auth and 2 minutes after it, no invitation; 201 within 2 minutes", async () => {
      const owner = await enrolledAdmin("owner@example.com", "owner");
      const cookie = await signIn(owner);
      let invitationsAfterRefusals = -1;

      const responses = await windowResponses(owner, cookie, async () => {
        const res = await invite(cookie, "owner");
        if (res.statusCode === 403) invitationsAfterRefusals = await prisma.adminInvitation.count();
        return res;
      });

      expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 201]);
      expect(responses.slice(0, 2).map((res) => res.json().message)).toEqual([REAUTH_REQUIRED, REAUTH_REQUIRED]);
      expect(invitationsAfterRefusals).toBe(0);
      expect(await prisma.adminInvitation.findMany({ select: { role: true } })).toEqual([{ role: "owner" }]);
    });

    it.each(["operations", "finance", "support", "viewer"])("control: inviting with role %s needs no re-auth (201)", async (role) => {
      const owner = await enrolledAdmin("owner@example.com", "owner");
      const cookie = await signIn(owner);

      const res = await invite(cookie, role);

      expect(res.statusCode).toBe(201);
    });
  });
});
