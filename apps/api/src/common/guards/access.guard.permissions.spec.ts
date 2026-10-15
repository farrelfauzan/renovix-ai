import { Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import { Access } from "../decorators/access.decorator";
import { AdminRoleService } from "../../app/admin-auth/service/admin-role.service";
import { AdminSessionService } from "../../app/admin-auth/service/admin-session.service";
import { PiiRevealService } from "../../app/admin-auth/service/pii-reveal.service";
import type { AdminRequest } from "../../app/admin-auth/types/admin-request";
import { PrismaService } from "../../app/prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../test/test-module";
import { resetDatabase } from "../../../test/test-database";
import { createUser } from "../../../test/factories";
import { BACK_OFFICE_ORIGIN, seedAdminRoles } from "../../../test/admin-auth";

// RX-96: the staff permissions of the global AccessGuard, through real HTTP (Fastify `inject`) with the
// real session and role check on the test database. The routes below exist only in this spec: main has no
// credit-adjustment or personal-data route yet. Sessions are started with AdminSessionService directly.
const mockGetSession = jest.fn();
jest.mock("../../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

/** Stands for the write a credit adjustment would make (a ledger row): it must not run on a refused request. */
const writeAdjustment = jest.fn();

@Controller("admin/rbac-probe")
class RbacProbeController {
  constructor(private readonly pii: PiiRevealService) {}

  @Post("credits/adjust")
  @HttpCode(200)
  @Access({ auth: ["staff"], permissions: ["credits:adjust"] })
  adjust(@Req() request: AdminRequest) {
    writeAdjustment(request.admin.adminId);
    return { written: true };
  }

  @Get("two")
  @Access({ auth: ["staff"], permissions: ["users:read", "credits:adjust"] })
  two() {
    return { ok: true };
  }

  @Get("pii/:userId")
  @Access({ auth: ["staff"], permissions: ["users:read"] })
  async reveal(@Req() request: AdminRequest, @Param("userId") userId: string) {
    return { canReveal: await this.pii.canRevealPii(request.admin, userId) };
  }
}

@Controller("product-probe")
class ProductProbeController {
  @Get("login")
  @Access({ auth: ["jwt", "session"] })
  login() {
    return { ok: true };
  }

  @Get("api-key")
  @Access({ auth: ["apiKey"] })
  apiKey() {
    return { ok: true };
  }
}

const API_KEY = "sk_live_rx96-valid-key";
const BETTER_AUTH_COOKIE = "better-auth.session_token=rx96";
const ACCESS = "rx_admin_access";
const ADJUST = "/admin/rbac-probe/credits/adjust";
const HOUR = 3_600_000;

describe("AccessGuard staff permissions (RX-96, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let sessions: AdminSessionService;
  let user: { id: string; email: string };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [RbacProbeController, ProductProbeController],
      providers: [PiiRevealService, AdminRoleService],
    }));
    app = await createFastifyApp(moduleRef);
    sessions = moduleRef.get(AdminSessionService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAdminRoles(prisma);
    user = await createUser(prisma, { apiKey: API_KEY });
    writeAdjustment.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue(null);
  });

  afterAll(() => app?.close());

  /** An admin of this role with a session of this scope; returns the admin id and the access cookie. */
  const signedIn = async (role: string, scope = "full") => {
    const admin = await prisma.adminUser.create({ data: { email: `${role}-${scope}@example.com`, passwordHash: "not-used", role } });
    const session = await sessions.start(admin.id, scope, "jest");
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const adjust = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: ADJUST, headers: { ...BACK_OFFICE_ORIGIN, ...headers } });
  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
  const setPermissions = (name: string, permissions: string[]) =>
    prisma.adminRole.update({ where: { name }, data: { permissions } });
  const loginJwt = (extra: object = {}) =>
    `Bearer ${jwt.sign({ userId: user.id, email: user.email, ...extra }, process.env.JWT_SECRET!)}`;

  describe("criterion 2: a credit adjustment needs credits:adjust", () => {
    it("Viewer: 403 and nothing written", async () => {
      const { cookie } = await signedIn("viewer");

      const res = await adjust({ cookie });

      expect(res.statusCode).toBe(403);
      expect(writeAdjustment).not.toHaveBeenCalled();
    });

    it.each(["operations", "support"])("%s (F5: no credit adjustments): 403 and nothing written", async (role) => {
      const { cookie } = await signedIn(role);

      const res = await adjust({ cookie });

      expect(res.statusCode).toBe(403);
      expect(writeAdjustment).not.toHaveBeenCalled();
    });

    it.each(["finance", "owner"])("%s: 200 and the write runs once", async (role) => {
      const { adminId, cookie } = await signedIn(role);

      const res = await adjust({ cookie });

      expect(res.statusCode).toBe(200);
      expect(writeAdjustment).toHaveBeenCalledTimes(1);
      expect(writeAdjustment).toHaveBeenCalledWith(adminId);
    });

    it("a role with credits:adjust but an enrolment session: 403 (scope first), nothing written", async () => {
      const { cookie } = await signedIn("owner", "enrolment");

      const res = await adjust({ cookie });

      expect(res.statusCode).toBe(403);
      expect(writeAdjustment).not.toHaveBeenCalled();
    });

    it("a refused request does not count as activity (lastSeenAt unchanged)", async () => {
      const { adminId, cookie } = await signedIn("viewer");
      const before = await prisma.adminSession.findFirstOrThrow({ where: { adminId } });

      await adjust({ cookie });

      const after = await prisma.adminSession.findFirstOrThrow({ where: { adminId } });
      expect(after.lastSeenAt).toEqual(before.lastSeenAt);
    });
  });

  describe("every declared permission is required", () => {
    it("a custom role holding only one of the two: 403; holding both: 200", async () => {
      await prisma.adminRole.create({ data: { name: "adjuster", permissions: ["credits:adjust"] } });
      const { cookie } = await signedIn("adjuster");
      const refused = await get("/admin/rbac-probe/two", { cookie });
      await setPermissions("adjuster", ["credits:adjust", "users:read"]);

      const accepted = await get("/admin/rbac-probe/two", { cookie });

      expect(refused.statusCode).toBe(403);
      expect(accepted.statusCode).toBe(200);
    });

    it("a role with no permissions: 403 on a permission route", async () => {
      await prisma.adminRole.create({ data: { name: "empty" } });
      const { cookie } = await signedIn("empty");

      expect((await get("/admin/rbac-probe/two", { cookie })).statusCode).toBe(403);
    });
  });

  describe("criterion 3: a role change applies on the next request, without signing out", () => {
    it("credits:adjust taken from Finance: the same session gets 403 next; given back: 200", async () => {
      const { cookie } = await signedIn("finance");
      const first = await adjust({ cookie });
      await setPermissions("finance", ["usage:read"]);
      const second = await adjust({ cookie });
      await setPermissions("finance", ["usage:read", "credits:adjust"]);

      const third = await adjust({ cookie });

      expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([200, 403, 200]);
      expect(writeAdjustment).toHaveBeenCalledTimes(2);
    });

    it("credits:adjust given to Viewer: the same session gets 200 next", async () => {
      const { cookie } = await signedIn("viewer");
      const before = await adjust({ cookie });
      await setPermissions("viewer", ["credits:adjust"]);

      const after = await adjust({ cookie });

      expect([before.statusCode, after.statusCode]).toEqual([403, 200]);
    });

    it("the admin moved from Finance to Viewer (AdminRoleService): the same session gets 403 next", async () => {
      const { adminId, cookie } = await signedIn("finance");
      const before = await adjust({ cookie });
      await moduleRef.get(AdminRoleService).assignRole(adminId, "viewer");

      const after = await adjust({ cookie });

      expect([before.statusCode, after.statusCode]).toEqual([200, 403]);
    });
  });

  // Criterion 1, kept at RX-94's 401 (M3): without a valid admin session the answer is 401 whatever product
  // credentials come along. A product credential never satisfies a staff route.
  describe("criterion 1: product credentials on a staff permission route: refused (401), nothing written", () => {
    it.each([
      ["a valid login JWT", () => ({ authorization: loginJwt() })],
      ["a valid login JWT that claims credits:adjust", () => ({ authorization: loginJwt({ permissions: ["credits:adjust"], role: "owner" }) })],
      ["a valid API key", () => ({ authorization: `Bearer ${API_KEY}` })],
      ["a login JWT inside the admin cookie", () => ({ cookie: `${ACCESS}=${loginJwt().slice(7)}` })],
    ])("%s: 401", async (_case, headers) => {
      const res = await adjust(headers());

      expect(res.statusCode).toBe(401);
      expect(writeAdjustment).not.toHaveBeenCalled();
    });

    it("a valid better-auth session cookie: 401", async () => {
      mockGetSession.mockResolvedValue({ user: { id: user.id, email: user.email }, session: { id: "s" } });

      const res = await adjust({ cookie: BETTER_AUTH_COOKIE });

      expect(res.statusCode).toBe(401);
      expect(writeAdjustment).not.toHaveBeenCalled();
    });

    it("a valid login JWT next to a Viewer's admin cookie: 403 (the admin session decides), nothing written", async () => {
      const { cookie } = await signedIn("viewer");

      const res = await adjust({ cookie, authorization: loginJwt({ permissions: ["credits:adjust"] }) });

      expect(res.statusCode).toBe(403);
      expect(writeAdjustment).not.toHaveBeenCalled();
    });
  });

  describe("criterion 5: an admin session on a product route", () => {
    it.each(["/product-probe/login", "/product-probe/api-key"])("an Owner's admin cookie on %s: 401", async (url) => {
      const { cookie } = await signedIn("owner");

      expect((await get(url, { cookie })).statusCode).toBe(401);
    });
  });

  describe("personal-data reveal (D56)", () => {
    const reveal = async (cookie: string, userId = user.id) => {
      const res = await get(`/admin/rbac-probe/pii/${userId}`, { cookie });
      expect(res.statusCode).toBe(200);
      return res.json().canReveal;
    };
    const grant = (adminId: string, subjectUserId: string, expiresAt: Date) =>
      prisma.adminPiiGrant.create({
        data: { adminId, subjectUserId, reason: "ticket 42", grantedByAdminId: adminId, expiresAt },
      });

    it.each([
      ["owner", true],
      ["operations", true],
      ["finance", false],
      ["viewer", false],
      ["support", false],
    ])("%s without a grant: %s", async (role, expected) => {
      const { cookie } = await signedIn(role);

      expect(await reveal(cookie)).toBe(expected);
    });

    it("Support with an unexpired grant for this user: true; for another user: false", async () => {
      const { adminId, cookie } = await signedIn("support");
      const other = await createUser(prisma);
      await grant(adminId, user.id, new Date(Date.now() + HOUR));

      expect(await reveal(cookie, user.id)).toBe(true);
      expect(await reveal(cookie, other.id)).toBe(false);
    });

    it("Support with an expired grant: false", async () => {
      const { adminId, cookie } = await signedIn("support");
      await grant(adminId, user.id, new Date(Date.now() - 1000));

      expect(await reveal(cookie)).toBe(false);
    });

    it("another Support admin's grant does not count", async () => {
      const holder = await signedIn("support");
      await grant(holder.adminId, user.id, new Date(Date.now() + HOUR));
      const second = await prisma.adminUser.create({ data: { email: "support-2@example.com", passwordHash: "not-used", role: "support" } });
      const session = await sessions.start(second.id, "full", "jest");

      expect(await reveal(`${ACCESS}=${session.accessToken}`)).toBe(false);
    });

    it("a Viewer with a grant: false (only Support may use a per-case grant)", async () => {
      const { adminId, cookie } = await signedIn("viewer");
      await grant(adminId, user.id, new Date(Date.now() + HOUR));

      expect(await reveal(cookie)).toBe(false);
    });

    it("users:read_pii taken from Operations: false on the next request", async () => {
      const { cookie } = await signedIn("operations");
      const before = await reveal(cookie);
      await setPermissions("operations", ["users:read"]);

      expect([before, await reveal(cookie)]).toEqual([true, false]);
    });
  });
});
