import { randomUUID } from "node:crypto";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminUsersModule } from "../admin-users.module";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";
import { createPackageSnapshot, createUser } from "../../../../test/factories";
import { fundPaidWallet } from "../../../../test/credit-funding";

// RNX-357: the back-office users API (list, masked detail, audited reveal) through real HTTP (Fastify `inject`), the
// real AccessGuard, audit hook and PrismaService on the test database. Made-up values only.

const ACCESS = "rx_admin_access";
const MINUTE = 60_000;
const REASON = "ticket 5120: account question";
/** Every key of a list item, a package, the detail and a ledger entry: a new field fails these on purpose (AC2). */
const ITEM_KEYS = ["creditsBalance", "email", "id", "lastLoginAt", "name", "package", "status"];
const PACKAGE_KEYS = ["id", "name"];
const DETAIL_KEYS = [...ITEM_KEYS, "joinedAt", "language", "ledger", "phone", "signInMethods", "timezone"].sort();
const LEDGER_KEYS = ["amount", "balanceAfter", "createdAt", "id", "type", "wallet"];
/** The personal data and secrets of the seeded user (AC2): none of them may appear in a response. */
const SECRET = {
  email: "rahasia.pribadi@example.com",
  phone: "+62 812-3456-7890",
  name: "Rahasia Pribadi",
  lastLoginIp: "203.0.113.77",
  userPassword: "$2b$10$madeUpUserPasswordHashValue000000000000000000000",
  accountPassword: "$2b$10$madeUpAccountPasswordHashValue0000000000000000",
  accessToken: "made-up-access-token-7f3a",
  refreshToken: "made-up-refresh-token-91bc",
  idToken: "made-up-id-token-c0de",
  sessionToken: "made-up-session-token-5e55",
  sessionIp: "198.51.100.23",
  sessionAgent: "MadeUpAgent/1.0",
  conversationTitle: "Made-up conversation about rahasia",
  memoryContent: "Made-up memory: likes durian",
};

type Json = Record<string, any>;

describe("Back-office users API (RNX-357, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminUsersModule] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  /** An admin of this role (built-in, or a custom role with exactly `permissions`) with a full session; id and cookie. */
  const signedIn = async (role: string, permissions?: string[]) => {
    if (permissions) await prisma.adminRole.create({ data: { name: role, builtIn: false, permissions } });
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}-${randomUUID().slice(0, 6)}@example.com`, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const get = (cookie: string, url: string) => app.inject({ method: "GET", url, headers: { ...BACK_OFFICE_ORIGIN, cookie } });
  const post = (cookie: string, url: string, payload: Json) => app.inject({ method: "POST", url, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  const reveal = (cookie: string, userId: string, payload: Json = { field: "email", reason: REASON }) => post(cookie, `/admin/users/${userId}/reveal`, payload);
  const revealRows = () => prisma.adminAuditLog.findMany({ where: { resource: "user_pii", action: "reveal" } });
  const idsOf = (body: Json): string[] => body.items.map((item: Json) => item.id);
  /** A paid wallet with these balance and held credits, written straight to the account row. */
  const paidWallet = (userId: string, balance: string, held = "0") => prisma.creditAccount.create({ data: { userId, wallet: "paid", balance, held } });
  /** A per-case grant (D56) for this Support admin and user, expiring at `expiresAt`. */
  const grant = async (adminId: string, subjectUserId: string, expiresAt: Date) => {
    const granter = await signedIn("owner");
    await prisma.adminPiiGrant.create({ data: { adminId, subjectUserId, reason: "case 77", grantedByAdminId: granter.adminId, expiresAt } });
  };
  /** The user of AC2 with every personal value and secret set: accounts, a session, a conversation and a memory. */
  const seedSecretUser = async () => {
    const user = await createUser(prisma, {
      email: SECRET.email, phone: SECRET.phone, name: SECRET.name, lastLoginIp: SECRET.lastLoginIp, password: SECRET.userPassword,
      lastLoginAt: new Date("2026-11-20T08:00:00Z"), timezone: "Asia/Jakarta", locale: "id",
    });
    await prisma.account.create({
      data: {
        userId: user.id, accountId: "google-sub-1", providerId: "google", accessToken: SECRET.accessToken, refreshToken: SECRET.refreshToken, idToken: SECRET.idToken,
      },
    });
    await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: SECRET.accountPassword } });
    await prisma.session.create({
      data: { userId: user.id, token: SECRET.sessionToken, ipAddress: SECRET.sessionIp, userAgent: SECRET.sessionAgent, expiresAt: new Date(Date.now() + MINUTE) },
    });
    await prisma.conversation.create({ data: { userId: user.id, title: SECRET.conversationTitle, model: "m-test" } });
    await prisma.userMemory.create({ data: { userId: user.id, type: "interest", content: SECRET.memoryContent } });
    await createPackageSnapshot(prisma, { userId: user.id, name: "Starter-rnx357" });
    await fundPaidWallet(prisma, user.id, 25);
    return user;
  };

  describe("AC1: lookup by exact email or id only, no enumeration by prefix", () => {
    it("an exact email returns exactly that user, in any letter case; a prefix, a substring or a longer text returns nothing", async () => {
      const target = await createUser(prisma, { email: "budi.santoso@example.com" });
      await createUser(prisma, { email: "budi.santoso2@example.com" });
      await createUser(prisma, { email: "abudi.santoso@example.com" });
      const { cookie } = await signedIn("support");

      const exact = await get(cookie, "/admin/users?email=budi.santoso%40example.com");
      const upperCase = await get(cookie, "/admin/users?email=Budi.Santoso%40EXAMPLE.com");
      const misses = await Promise.all(
        ["budi", "budi.santoso", "budi.santoso%40", "udi.santoso%40example.com", "santoso%40example.com", "budi.santoso%40example.co", "budi.santoso%40example.com.au", "%25budi%25", "budi*"].map((email) =>
          get(cookie, `/admin/users?email=${email}`),
        ),
      );

      expect(exact.statusCode).toBe(200);
      expect(idsOf(exact.json())).toEqual([target.id]);
      expect(idsOf(upperCase.json())).toEqual([target.id]);
      expect(misses.map((res) => [res.statusCode, res.json().items])).toEqual(misses.map(() => [200, []]));
    });

    it("an exact id returns exactly that user; a prefix of the id returns nothing", async () => {
      const target = await createUser(prisma);
      await createUser(prisma);
      const { cookie } = await signedIn("support");

      const exact = await get(cookie, `/admin/users?id=${target.id}`);
      const prefix = await get(cookie, `/admin/users?id=${target.id.slice(0, 8)}`);

      expect(idsOf(exact.json())).toEqual([target.id]);
      expect(prefix.json().items).toEqual([]);
    });
  });

  describe("the list: status and package filters, order and pages", () => {
    it("status is suspended, locked (no paid wallet, or available credits at or below 0) or active; the filter matches the label; deleted users are left out", async () => {
      const active = await createUser(prisma);
      await paidWallet(active.id, "10", "4");
      const heldToZero = await createUser(prisma);
      await paidWallet(heldToZero.id, "5", "5");
      const empty = await createUser(prisma);
      await paidWallet(empty.id, "0");
      const noWallet = await createUser(prisma);
      const suspended = await createUser(prisma, { status: "suspended" });
      await paidWallet(suspended.id, "10");
      const deleted = await createUser(prisma, { status: "deleted" });
      await paidWallet(deleted.id, "10");
      const { cookie } = await signedIn("support");

      const all = (await get(cookie, "/admin/users")).json();
      const byStatus = async (status: string) => idsOf((await get(cookie, `/admin/users?status=${status}`)).json()).sort();

      expect(Object.fromEntries(all.items.map((item: Json) => [item.id, item.status]))).toEqual({
        [active.id]: "active", [heldToZero.id]: "locked", [empty.id]: "locked", [noWallet.id]: "locked", [suspended.id]: "suspended",
      });
      expect(await byStatus("active")).toEqual([active.id]);
      expect(await byStatus("locked")).toEqual([heldToZero.id, empty.id, noWallet.id].sort());
      expect(await byStatus("suspended")).toEqual([suspended.id]);
      expect((await get(cookie, `/admin/users?id=${deleted.id}`)).json().items).toEqual([]);
      expect((await get(cookie, `/admin/users?email=${encodeURIComponent(deleted.email)}`)).json().items).toEqual([]);
    });

    it("the package is the one the entitlement reports (highest display order); the package filter matches it", async () => {
      const both = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: both.id, name: "Starter-357", displayOrder: 1 });
      await createPackageSnapshot(prisma, { userId: both.id, name: "Pro-357", displayOrder: 2 });
      const starterOnly = await createUser(prisma);
      await createPackageSnapshot(prisma, { userId: starterOnly.id, name: "Solo-357", displayOrder: 1 });
      const none = await createUser(prisma);
      const pro = await prisma.package.findUniqueOrThrow({ where: { name: "Pro-357" } });
      const starter = await prisma.package.findUniqueOrThrow({ where: { name: "Starter-357" } });
      const { cookie } = await signedIn("support");

      const all = (await get(cookie, "/admin/users")).json();

      expect(Object.fromEntries(all.items.map((item: Json) => [item.id, item.package]))).toEqual({
        [both.id]: { id: pro.id, name: "Pro-357" }, [starterOnly.id]: { id: expect.any(String), name: "Solo-357" }, [none.id]: null,
      });
      expect(idsOf((await get(cookie, `/admin/users?packageId=${pro.id}`)).json())).toEqual([both.id]);
      expect(idsOf((await get(cookie, `/admin/users?packageId=${starter.id}`)).json())).toEqual([]);
    });

    it("newest sign-in first, never signed in last, ties by id; 50 per page with hasMore; a page past the end is empty", async () => {
      const at = (iso: string) => new Date(iso);
      const older = await createUser(prisma, { lastLoginAt: at("2026-11-01T00:00:00Z") });
      const newest = await createUser(prisma, { lastLoginAt: at("2026-11-03T00:00:00Z") });
      const tieA = await createUser(prisma, { lastLoginAt: at("2026-11-02T00:00:00Z") });
      const tieB = await createUser(prisma, { lastLoginAt: at("2026-11-02T00:00:00Z") });
      await prisma.user.createMany({ data: Array.from({ length: 47 }, (_, i) => ({ email: `never-${i}-${randomUUID().slice(0, 6)}@example.com` })) });
      const { cookie } = await signedIn("support");

      const first = (await get(cookie, "/admin/users")).json();
      const second = (await get(cookie, "/admin/users?page=2")).json();
      const past = (await get(cookie, "/admin/users?page=3")).json();
      const farPast = await get(cookie, "/admin/users?page=1000000000000");

      const [tieFirst, tieSecond] = [tieA.id, tieB.id].sort();
      expect(idsOf(first).slice(0, 4)).toEqual([newest.id, tieFirst, tieSecond, older.id]);
      expect(first.items.slice(4).every((item: Json) => item.lastLoginAt === null)).toBe(true);
      const neverIds = [...idsOf(first).slice(4), ...idsOf(second)];
      expect(neverIds).toEqual([...neverIds].sort());
      expect({ page: first.page, pageSize: first.pageSize, hasMore: first.hasMore, items: first.items.length }).toEqual({ page: 1, pageSize: 50, hasMore: true, items: 50 });
      expect({ page: second.page, hasMore: second.hasMore, items: second.items.length }).toEqual({ page: 2, hasMore: false, items: 1 });
      expect({ hasMore: past.hasMore, items: past.items }).toEqual({ hasMore: false, items: [] });
      expect(farPast.statusCode).toBe(200);
      expect(farPast.json().items).toEqual([]);
    });

    it("an unknown status, an unknown parameter or page 0 is a 400 that does not echo the searched email", async () => {
      const { cookie } = await signedIn("support");

      const responses = await Promise.all(
        ["status=deleted", "status=bogus", "role=admin", "page=0", "page=-1"].map((query) => get(cookie, `/admin/users?email=searched.person%40example.com&${query}`)),
      );

      expect(responses.map((res) => res.statusCode)).toEqual([400, 400, 400, 400, 400]);
      expect(responses.map((res) => res.body).join("\n")).not.toContain("searched.person");
    });
  });

  describe("AC2: the list and the detail mask every email, phone and name and hold no IP, hash, token, conversation or memory", () => {
    it("exact key sets on every object, and none of the seeded personal values or secrets anywhere in the bodies", async () => {
      const user = await seedSecretUser();
      const { cookie } = await signedIn("owner");

      const list = await get(cookie, "/admin/users");
      const detail = await get(cookie, `/admin/users/${user.id}`);

      expect([list.statusCode, detail.statusCode]).toEqual([200, 200]);
      const page = list.json();
      expect(Object.keys(page).sort()).toEqual(["hasMore", "items", "page", "pageSize"]);
      expect(page.items).toHaveLength(1);
      expect(Object.keys(page.items[0]).sort()).toEqual(ITEM_KEYS);
      expect(Object.keys(page.items[0].package).sort()).toEqual(PACKAGE_KEYS);
      expect(page.items[0]).toMatchObject({ id: user.id, email: "***", name: "***", creditsBalance: "25", status: "active", package: { name: "Starter-rnx357" } });
      const body = detail.json();
      expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS);
      expect(Object.keys(body.package).sort()).toEqual(PACKAGE_KEYS);
      expect(body.ledger.length).toBeGreaterThan(0);
      expect(body.ledger.every((entry: Json) => JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(LEDGER_KEYS))).toBe(true);
      expect(body).toMatchObject({
        id: user.id, email: "***", name: "***", phone: "***", timezone: "Asia/Jakarta", language: "id", signInMethods: ["credential", "google"],
        joinedAt: user.createdAt.toISOString(), lastLoginAt: "2026-11-20T08:00:00.000Z",
      });
      const bodies = `${list.body}\n${detail.body}`;
      for (const value of Object.values(SECRET)) expect(bodies).not.toContain(value);
      expect(bodies.toLowerCase()).not.toContain("rahasia");
    });

    it("a name or phone the user has not set stays null; the email is always masked", async () => {
      const user = await createUser(prisma, { name: null, phone: null });
      const { cookie } = await signedIn("support");

      const item = (await get(cookie, "/admin/users")).json().items[0];
      const detail = (await get(cookie, `/admin/users/${user.id}`)).json();

      expect(item).toMatchObject({ email: "***", name: null });
      expect(detail).toMatchObject({ email: "***", name: null, phone: null });
    });
  });

  describe("the detail: the ledger needs credits:read; deleted users are not found", () => {
    it("with credits:read: the last 20 ledger entries, newest first; without it the detail still answers with ledger null", async () => {
      const user = await createUser(prisma);
      for (let i = 1; i <= 22; i += 1) await fundPaidWallet(prisma, user.id, i);
      const viewer = await signedIn("viewer");
      const support = await signedIn("support");

      const withCredits = await get(viewer.cookie, `/admin/users/${user.id}`);
      const withoutCredits = await get(support.cookie, `/admin/users/${user.id}`);

      expect(withCredits.statusCode).toBe(200);
      expect(withCredits.json().ledger.map((entry: Json) => entry.amount)).toEqual(Array.from({ length: 20 }, (_, i) => String(22 - i)));
      expect(withCredits.json().ledger[0]).toMatchObject({ wallet: "paid", type: "bonus", balanceAfter: "253" });
      expect(withoutCredits.statusCode).toBe(200);
      expect(withoutCredits.json()).toMatchObject({ id: user.id, creditsBalance: "253", ledger: null });
    });

    it("an empty ledger is [] for an admin with credits:read (distinct from null)", async () => {
      const user = await createUser(prisma);
      const { cookie } = await signedIn("viewer");

      expect((await get(cookie, `/admin/users/${user.id}`)).json().ledger).toEqual([]);
    });

    it("a deleted or unknown user: 404", async () => {
      const deleted = await createUser(prisma, { status: "deleted" });
      const { cookie } = await signedIn("owner");

      expect((await get(cookie, `/admin/users/${deleted.id}`)).statusCode).toBe(404);
      expect((await get(cookie, `/admin/users/${randomUUID()}`)).statusCode).toBe(404);
    });
  });

  describe("AC3: a role without users:read gets 403 on the list, the detail and the reveal", () => {
    it.each([
      ["a custom role with users:read_pii and credits:read only", "pii-credits", ["users:read_pii", "credits:read"]],
      ["a custom role with usage:read only", "usage-only", ["usage:read"]],
    ])("%s: 403 on all three, no audit row (negative)", async (_case, role, permissions) => {
      const user = await createUser(prisma);
      const { cookie } = await signedIn(role, permissions);

      const responses = [await get(cookie, "/admin/users"), await get(cookie, `/admin/users/${user.id}`), await reveal(cookie, user.id)];

      expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 403]);
      expect(await revealRows()).toEqual([]);
    });

    it("a grant only lifts masking: Support without users:read, holding an unexpired grant, gets 403 on all three", async () => {
      const user = await createUser(prisma);
      const support = await signedIn("support");
      await prisma.adminRole.update({ where: { name: "support" }, data: { permissions: ["companies:read", "support_notes:write"] } });
      await grant(support.adminId, user.id, new Date(Date.now() + 10 * MINUTE));

      const responses = [await get(support.cookie, "/admin/users"), await get(support.cookie, `/admin/users/${user.id}`), await reveal(support.cookie, user.id)];

      expect(responses.map((res) => res.statusCode)).toEqual([403, 403, 403]);
      expect(await revealRows()).toEqual([]);
    });

    it("control: a custom role with users:read only gets 200 on the list and the detail", async () => {
      const user = await createUser(prisma);
      const { cookie } = await signedIn("users-reader", ["users:read"]);

      expect((await get(cookie, "/admin/users")).statusCode).toBe(200);
      expect((await get(cookie, `/admin/users/${user.id}`)).statusCode).toBe(200);
    });
  });

  describe("AC4: the reveal", () => {
    it.each([
      ["Support (users:read, no users:read_pii, no grant)", "support", undefined],
      ["a custom role with users:read only", "users-reader", ["users:read"]],
    ])("(a) %s: 403 and no audit row; the value is not in the response", async (_case, role, permissions) => {
      const user = await seedSecretUser();
      const { cookie } = await signedIn(role, permissions);

      const res = await reveal(cookie, user.id);

      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(SECRET.email);
      expect(await revealRows()).toEqual([]);
    });

    it("(b) with users:read_pii, an empty or whitespace reason, a missing reason or an unknown field: 400 and no audit row", async () => {
      const user = await seedSecretUser();
      const { cookie } = await signedIn("operations");

      const responses = [
        await reveal(cookie, user.id, { field: "email", reason: "" }),
        await reveal(cookie, user.id, { field: "email", reason: "   \t " }),
        await reveal(cookie, user.id, { field: "email" }),
        await reveal(cookie, user.id, { field: "lastLoginIp", reason: REASON }),
        await reveal(cookie, user.id, { field: "email", reason: "x".repeat(501) }),
      ];

      expect(responses.map((res) => res.statusCode)).toEqual([400, 400, 400, 400, 400]);
      expect(responses.map((res) => res.body).join("\n")).not.toContain(SECRET.email);
      expect(await revealRows()).toEqual([]);
    });

    it.each([
      ["email", SECRET.email],
      ["phone", SECRET.phone],
      ["name", SECRET.name],
    ])("(c) a valid reveal of %s: { field, value } with the value once, and exactly one audit row with the field and the trimmed reason", async (field, value) => {
      const user = await seedSecretUser();
      const { adminId, cookie } = await signedIn("operations");

      const res = await reveal(cookie, user.id, { field, reason: `  ${REASON}  ` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ field, value });
      expect(res.body.split(value).length - 1).toBe(1);
      const rows = await revealRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        adminId, reason: REASON, before: { userId: user.id, field, revealed: false }, after: { userId: user.id, field, revealed: true },
      });
      expect(JSON.stringify(rows[0])).not.toContain(value);
    });

    it("decision 2: a field the user has not set is revealed as null, with exactly one audit row", async () => {
      const user = await createUser(prisma, { phone: null });
      const { cookie } = await signedIn("owner");

      const res = await reveal(cookie, user.id, { field: "phone", reason: REASON });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ field: "phone", value: null });
      expect(await revealRows()).toHaveLength(1);
    });

    it("a deleted or unknown user: 404 and no audit row", async () => {
      const deleted = await createUser(prisma, { status: "deleted" });
      const { cookie } = await signedIn("owner");

      expect((await reveal(cookie, deleted.id)).statusCode).toBe(404);
      expect((await reveal(cookie, randomUUID())).statusCode).toBe(404);
      expect(await revealRows()).toEqual([]);
    });
  });

  describe("AC5: Support with users:read, no users:read_pii, and a per-case grant", () => {
    it("an unexpired grant for that user: the reveal succeeds, exactly one audit row with the field and the reason", async () => {
      const user = await seedSecretUser();
      const support = await signedIn("support");
      await grant(support.adminId, user.id, new Date(Date.now() + 10 * MINUTE));

      const res = await reveal(support.cookie, user.id, { field: "name", reason: REASON });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ field: "name", value: SECRET.name });
      const rows = await revealRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ adminId: support.adminId, reason: REASON, after: { userId: user.id, field: "name", revealed: true } });
    });

    it("an expired grant: 403 and no audit row (negative)", async () => {
      const user = await seedSecretUser();
      const support = await signedIn("support");
      await grant(support.adminId, user.id, new Date(Date.now() - MINUTE));

      const res = await reveal(support.cookie, user.id);

      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(SECRET.email);
      expect(await revealRows()).toEqual([]);
    });

    it("an unexpired grant for a different user: 403 and no audit row (negative)", async () => {
      const user = await seedSecretUser();
      const other = await createUser(prisma);
      const support = await signedIn("support");
      await grant(support.adminId, other.id, new Date(Date.now() + 10 * MINUTE));

      const res = await reveal(support.cookie, user.id);

      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(SECRET.email);
      expect(await revealRows()).toEqual([]);
    });
  });
});
