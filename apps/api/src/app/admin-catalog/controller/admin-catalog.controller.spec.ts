import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminAuditLogRepository } from "../../admin-auth/repository/admin-audit-log.repository";
import { REAUTH_WINDOW_MINUTES } from "../../admin-auth/config/reauth-window";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { convertUsdCentsToRupiah } from "../../exchange-rates/utils/convert-usd-cents-to-rupiah";
import { PLATFORM_SETTINGS } from "../../offers/config/platform-settings";
import { OfferCatalogService } from "../../offers/service/offer-catalog.service";
import { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminCatalogModule } from "../admin-catalog.module";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";
import { createUser } from "../../../../test/factories";

// RNX-226: packages, top-up packs, Enterprise bundles, invitation codes and platform settings through the admin API,
// real HTTP (Fastify `inject`) on the test database. TEST_RATE is a throwaway USD to IDR rate; global fetch is stubbed
// to refuse, so no test calls the real exchange-rate API.

const ACCESS = "rx_admin_access";
const TEST_RATE = "16500";
const SEED_AUTHOR = { changedBy: "seed:test", reason: "RNX-226 test fixture" };
const STARTER_TERMS = {
  priceUsdCents: 1000,
  creditsGranted: 100,
  billing: "monthly" as const,
  maxAgents: 3,
  maxConnectedTools: 2,
  apiAccess: false,
  allowedChannels: ["web"],
  allowedTiers: ["standard" as const],
};

type Method = "GET" | "POST" | "PATCH" | "PUT";
type Fixture = { packageId: string; packId: string; bundleId: string; codeId: string; versionId: string };

describe("Admin catalog, codes and settings (RNX-226, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminCatalogModule] }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-226 test: no network"));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const catalog = () => moduleRef.get(OfferCatalogService, { strict: false });
  /**
   * An admin of this role with a full session, re-authenticated at `reauthAt` (now by default, so `reauth: true` routes
   * accept it; null for never); returns the admin id and the access cookie.
   */
  const signedIn = async (role: string, reauthAt: Date | null = new Date()) => {
    const admin = await createAdmin(prisma, moduleRef, { email: `${role}-${randomUUID().slice(0, 6)}@example.com`, role });
    const session = await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest");
    await prisma.adminSession.update({ where: { id: session.sessionId }, data: { lastReauthAt: reauthAt } });
    return { adminId: admin.id, cookie: `${ACCESS}=${session.accessToken}` };
  };
  const call = (method: Method, url: string, cookie: string, payload?: object) =>
    app.inject({ method, url, headers: { ...BACK_OFFICE_ORIGIN, cookie }, payload });
  const storeRate = () =>
    prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate: TEST_RATE, rateDate: new Date(Date.now() - 86_400_000), fetchedAt: new Date(), source: "frankfurter" } });
  const rupiah = (usdCents: number) => convertUsdCentsToRupiah({ usdCents, rate: new Decimal(TEST_RATE) });
  const now = () => new Date().toISOString();
  /** A listed package with version 1, a top-up pack with version 1, an Enterprise bundle and an invitation code. */
  const createFixture = async (): Promise<Fixture> => {
    const pkg = await catalog().savePackage({ name: "Starter", displayOrder: 1, active: true, visible: true }, SEED_AUTHOR);
    const version = await catalog().savePackageVersion({ ownerId: pkg.id, terms: STARTER_TERMS, author: SEED_AUTHOR });
    const pack = await catalog().saveTopUpPack({ name: "Top-up 20 credits", active: true }, SEED_AUTHOR);
    await catalog().saveTopUpPackVersion({ ownerId: pack.id, terms: { creditsGranted: 20, priceUsdCents: 500 }, author: SEED_AUTHOR });
    const bundle = await catalog().saveEnterpriseBundle({ name: "Enterprise pool", active: true }, SEED_AUTHOR);
    const code = await prisma.invitationCode.create({ data: { code: `TEST-${randomUUID().slice(0, 8)}`, type: "topup", creditAmount: 10 } });
    return { packageId: pkg.id, packId: pack.id, bundleId: bundle.id, codeId: code.id, versionId: version.id };
  };
  /** Every row the write routes can touch, to compare before and after a refused request. */
  const catalogState = async () => ({
    packages: await prisma.package.findMany({ orderBy: { id: "asc" } }),
    packageVersions: await prisma.packageVersion.findMany({ orderBy: { id: "asc" } }),
    packs: await prisma.topUpPack.findMany({ orderBy: { id: "asc" } }),
    packVersions: await prisma.topUpPackVersion.findMany({ orderBy: { id: "asc" } }),
    bundles: await prisma.enterpriseBundle.findMany({ orderBy: { id: "asc" } }),
    bundleVersions: await prisma.enterpriseBundleVersion.findMany({ orderBy: { id: "asc" } }),
    codes: await prisma.invitationCode.findMany({ orderBy: { id: "asc" } }),
    settings: await prisma.platformSetting.findMany({ orderBy: { name: "asc" } }),
    catalogChanges: await prisma.catalogChange.count(),
    purchaseSnapshots: await prisma.purchaseSnapshot.findMany({ orderBy: { id: "asc" } }),
  });
  /** Every write route, with a valid body: [label, method, url, body]. */
  const writeRoutes = (f: Fixture): [string, Method, string, object][] => [
    ["PATCH /admin/packages/:id", "PATCH", `/admin/packages/${f.packageId}`, { visible: false, reason: "hide for now" }],
    ["POST /admin/packages/:id/versions", "POST", `/admin/packages/${f.packageId}/versions`, { ...STARTER_TERMS, priceUsdCents: 1200, reason: "price change", effectiveFrom: now() }],
    ["PATCH /admin/top-up-packs/:id", "PATCH", `/admin/top-up-packs/${f.packId}`, { active: false, reason: "retire" }],
    ["POST /admin/top-up-packs/:id/versions", "POST", `/admin/top-up-packs/${f.packId}/versions`, { creditsGranted: 25, priceUsdCents: 600, reason: "more credits", effectiveFrom: now() }],
    ["PATCH /admin/enterprise-bundles/:id", "PATCH", `/admin/enterprise-bundles/${f.bundleId}`, { active: false, reason: "retire" }],
    ["POST /admin/enterprise-bundles/:id/versions", "POST", `/admin/enterprise-bundles/${f.bundleId}/versions`, { poolCreditsPerPeriod: null, monthlyPriceUsdCents: null, reason: "D1 open", effectiveFrom: now() }],
    ["POST /admin/codes", "POST", "/admin/codes", { type: "topup", creditAmount: 15 }],
    ["PATCH /admin/codes/:id", "PATCH", `/admin/codes/${f.codeId}`, { isActive: false }],
    ["PUT /admin/settings/:name", "PUT", "/admin/settings/seatCeiling", { value: 50, reason: "lower the ceiling" }],
  ];
  const WRITE_LABELS = [
    "PATCH /admin/packages/:id",
    "POST /admin/packages/:id/versions",
    "PATCH /admin/top-up-packs/:id",
    "POST /admin/top-up-packs/:id/versions",
    "PATCH /admin/enterprise-bundles/:id",
    "POST /admin/enterprise-bundles/:id/versions",
    "POST /admin/codes",
    "PATCH /admin/codes/:id",
    "PUT /admin/settings/:name",
  ];
  const routeOf = (f: Fixture, label: string) => writeRoutes(f).find(([name]) => name === label) as [string, Method, string, object];

  describe("AC1: a package price change", () => {
    it("creates a new version, GET /prices shows the new price at once, and an earlier buyer's snapshot is unchanged", async () => {
      await storeRate();
      const { adminId, cookie } = await signedIn("owner");
      const f = await createFixture();
      const buyer = await createUser(prisma);
      const snapshot = await moduleRef.get(PurchaseSnapshotService, { strict: false }).recordPackagePurchase({ buyerUserId: buyer.id, versionId: f.versionId, paymentId: null });
      const versionOneBefore = await prisma.packageVersion.findUniqueOrThrow({ where: { id: f.versionId } });
      const pricesBefore = await app.inject({ method: "GET", url: "/prices" });

      const created = await call("POST", `/admin/packages/${f.packageId}/versions`, cookie, { ...STARTER_TERMS, priceUsdCents: 1500, reason: "pilot price", effectiveFrom: now() });
      const pricesAfter = await app.inject({ method: "GET", url: "/prices" });

      expect(pricesBefore.json().packages).toEqual([{ name: "Starter", credits: 100, priceRupiah: rupiah(1000) }]);
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ packageId: f.packageId, versionNumber: 2, priceUsdCents: 1500, createdBy: adminId, reason: "pilot price" });
      expect(pricesAfter.statusCode).toBe(200);
      expect(pricesAfter.json().packages).toEqual([{ name: "Starter", credits: 100, priceRupiah: rupiah(1500) }]);
      expect(await prisma.purchaseSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).toEqual(snapshot);
      expect(await prisma.packageVersion.findUniqueOrThrow({ where: { id: f.versionId } })).toEqual(versionOneBefore);
      const change = await prisma.catalogChange.findFirstOrThrow({ where: { entity: "package_version", entityId: created.json().id } });
      expect(change).toMatchObject({ changedBy: adminId, reason: "pilot price" });
      const audit = await prisma.adminAuditLog.findMany({ where: { resource: "package" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ adminId, action: "create_version", reason: "pilot price" });
      expect(audit[0].before).toEqual({ packageId: f.packageId, versionNumber: 1 });
      expect(audit[0].after).toEqual({ packageId: f.packageId, versionId: created.json().id, versionNumber: 2, changedFields: "priceUsdCents" });
    });

    it("a version with a future effective date is stored but GET /prices keeps the current price until then", async () => {
      await storeRate();
      const { cookie } = await signedIn("owner");
      const f = await createFixture();
      const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();

      const created = await call("POST", `/admin/packages/${f.packageId}/versions`, cookie, { ...STARTER_TERMS, priceUsdCents: 1500, reason: "next week", effectiveFrom: nextWeek });
      const prices = await app.inject({ method: "GET", url: "/prices" });

      expect(created.statusCode).toBe(201);
      expect(new Date(created.json().effectiveFrom).toISOString()).toBe(nextWeek);
      expect(prices.json().packages).toEqual([{ name: "Starter", credits: 100, priceRupiah: rupiah(1000) }]);
    });

    it("the same terms again create no version and the latest stays", async () => {
      const { cookie } = await signedIn("owner");
      const f = await createFixture();

      const res = await call("POST", `/admin/packages/${f.packageId}/versions`, cookie, { ...STARTER_TERMS, reason: "no change", effectiveFrom: now() });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ id: f.versionId, versionNumber: 1 });
      expect(await prisma.packageVersion.count()).toBe(1);
    });

    it("a top-up pack price change shows on GET /prices at once; an unknown package is a 404 and writes nothing", async () => {
      await storeRate();
      const { cookie } = await signedIn("owner");
      const f = await createFixture();

      const created = await call("POST", `/admin/top-up-packs/${f.packId}/versions`, cookie, { creditsGranted: 20, priceUsdCents: 700, reason: "D237 review", effectiveFrom: now() });
      const prices = await app.inject({ method: "GET", url: "/prices" });
      const unknown = await call("POST", `/admin/packages/${randomUUID()}/versions`, cookie, { ...STARTER_TERMS, reason: "x", effectiveFrom: now() });

      expect(created.statusCode).toBe(201);
      expect(prices.json().topUpPacks).toEqual([{ name: "Top-up 20 credits", credits: 20, priceRupiah: rupiah(700) }]);
      expect(unknown.statusCode).toBe(404);
      expect(await prisma.packageVersion.count()).toBe(1);
    });
  });

  describe("reads", () => {
    it("lists and reads packages, packs and bundles with their versions, newest first; an unknown id is a 404", async () => {
      const { cookie } = await signedIn("viewer");
      const f = await createFixture();
      await catalog().savePackageVersion({ ownerId: f.packageId, terms: { ...STARTER_TERMS, maxAgents: 5 }, author: SEED_AUTHOR });

      const packages = await call("GET", "/admin/packages", cookie);
      const one = await call("GET", `/admin/packages/${f.packageId}`, cookie);
      const packs = await call("GET", "/admin/top-up-packs", cookie);
      const bundle = await call("GET", `/admin/enterprise-bundles/${f.bundleId}`, cookie);
      const missing = await call("GET", `/admin/top-up-packs/${randomUUID()}`, cookie);

      expect(packages.statusCode).toBe(200);
      expect(packages.json().map((p: { name: string }) => p.name)).toEqual(["Starter"]);
      expect(one.json().versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
      expect(packs.json()).toHaveLength(1);
      expect(bundle.json()).toMatchObject({ id: f.bundleId, versions: [] });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe("package, pack and bundle flags", () => {
    it("PATCH changes the flags, writes a catalog change and an audit row with the values before and after", async () => {
      const { adminId, cookie } = await signedIn("owner");
      const f = await createFixture();

      const res = await call("PATCH", `/admin/packages/${f.packageId}`, cookie, { displayOrder: 4, visible: false, reason: "reorder" });
      const name = await call("PATCH", `/admin/packages/${f.packageId}`, cookie, { name: "Renamed", reason: "x" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: "Starter", displayOrder: 4, active: true, visible: false });
      expect(name.statusCode).toBe(400);
      const [audit] = await prisma.adminAuditLog.findMany({ where: { resource: "package", action: "update" } });
      expect(audit).toMatchObject({ adminId, reason: "reorder" });
      expect(audit.before).toEqual({ packageId: f.packageId, displayOrder: 1, active: true, visible: true });
      expect(audit.after).toEqual({ packageId: f.packageId, displayOrder: 4, active: true, visible: false });
      expect(await prisma.catalogChange.count({ where: { entity: "package", entityId: f.packageId, changedBy: adminId } })).toBe(1);
    });
  });

  describe("invitation codes (D33)", () => {
    it("creates, lists, deactivates and shows redemptions; the audit row never holds the code text", async () => {
      const { adminId, cookie } = await signedIn("owner");
      const created = await call("POST", "/admin/codes", cookie, { type: "topup", creditAmount: 15, maxRedemptions: 3 });
      const codeId: string = created.json().id;
      const user = await createUser(prisma);
      await prisma.codeRedemption.create({ data: { codeId, userId: user.id, creditsGranted: 15 } });

      const listed = await call("GET", "/admin/codes", cookie);
      const redemptions = await call("GET", `/admin/codes/${codeId}/redemptions`, cookie);
      const deactivated = await call("PATCH", `/admin/codes/${codeId}`, cookie, { isActive: false });
      const reactivate = await call("PATCH", `/admin/codes/${codeId}`, cookie, { isActive: true });
      const missing = await call("GET", `/admin/codes/${randomUUID()}/redemptions`, cookie);

      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ type: "topup", maxRedemptions: 3, isActive: true, createdById: adminId });
      expect(created.json().code).toMatch(/^PERF-[0-9A-F]{4}-[0-9A-F]{4}$/);
      expect(listed.json()).toMatchObject({ total: 1, page: 1, limit: 50 });
      expect(listed.json().codes[0]).toMatchObject({ id: codeId, _count: { redemptions: 1 } });
      expect(redemptions.json()).toEqual([expect.objectContaining({ codeId, userId: user.id, creditsGranted: "15" })]);
      expect(deactivated.statusCode).toBe(200);
      expect(deactivated.json()).toMatchObject({ id: codeId, isActive: false });
      expect(reactivate.statusCode).toBe(400);
      expect(missing.statusCode).toBe(404);
      const audit = await prisma.adminAuditLog.findMany({ where: { resource: "invitation_code" }, orderBy: { createdAt: "asc" } });
      expect(audit.map((row) => [row.action, row.after])).toEqual([
        ["create", { codeId, type: "topup", maxRedemptions: 3, isActive: true }],
        ["deactivate", { codeId, isActive: false }],
      ]);
      expect(JSON.stringify(audit)).not.toContain(created.json().code);
    });
  });

  describe("code texts are redeemable secrets: the code reads need packages:write", () => {
    /** A code with one redemption; returns its id and its text. */
    const createRedeemedCode = async () => {
      const code = await prisma.invitationCode.create({ data: { code: `SECRET-${randomUUID().slice(0, 8)}`, type: "topup", creditAmount: 10 } });
      const user = await createUser(prisma);
      await prisma.codeRedemption.create({ data: { codeId: code.id, userId: user.id, creditsGranted: 10 } });
      return { codeId: code.id, text: code.code };
    };

    it.each([["GET /admin/codes"], ["GET /admin/codes/:id/redemptions"]])("%s: viewer (read only) gets 403 and no code text", async (label) => {
      const { cookie } = await signedIn("viewer");
      const { codeId, text } = await createRedeemedCode();
      const url = label === "GET /admin/codes" ? "/admin/codes" : `/admin/codes/${codeId}/redemptions`;

      const res = await call("GET", url, cookie);

      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(text);
      expect(res.body).not.toContain(codeId);
    });

    it("control: finance (packages:write) gets 200 on both reads", async () => {
      const { cookie } = await signedIn("finance");
      const { codeId, text } = await createRedeemedCode();

      const list = await call("GET", "/admin/codes", cookie);
      const redemptions = await call("GET", `/admin/codes/${codeId}/redemptions`, cookie);

      expect(list.statusCode).toBe(200);
      expect(list.json().codes.map((c: { code: string }) => c.code)).toEqual([text]);
      expect(redemptions.statusCode).toBe(200);
      expect(redemptions.json()).toEqual([expect.objectContaining({ codeId })]);
    });
  });

  describe("platform settings", () => {
    it("GET lists every registry name, null when not set (the open decisions have no default)", async () => {
      const { cookie } = await signedIn("viewer");
      await prisma.platformSetting.create({ data: { name: "seatCeiling", value: 100 } });

      const res = await call("GET", "/admin/settings", cookie);

      expect(res.statusCode).toBe(200);
      expect(res.json().map((s: { name: string }) => s.name)).toEqual(Object.keys(PLATFORM_SETTINGS));
      const values = Object.fromEntries(res.json().map((s: { name: string; value: unknown }) => [s.name, s.value]));
      expect(values).toMatchObject({ seatCeiling: 100, weeklyFreeAllowanceCredits: null, demoRunsPerAccountPerWeek: null, runOutAmberDays: null });
      expect(values).toMatchObject({ anonymousRequestsPerIpPerDay: null, anonymousRequestsGlobalPerDay: null, graceDays: null, repeatOffenderThreshold: null });
    });

    it("PUT writes the value with a catalog change and an audit row with the values before and after", async () => {
      const { adminId, cookie } = await signedIn("owner");
      await prisma.platformSetting.create({ data: { name: "seatCeiling", value: 100 } });

      const res = await call("PUT", "/admin/settings/seatCeiling", cookie, { value: 50, reason: "lower the ceiling" });
      const grace = await call("PUT", "/admin/settings/graceDays", cookie, { value: 0, reason: "D27 test value" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ name: "seatCeiling", value: 50 });
      expect(grace.json()).toEqual({ name: "graceDays", value: 0 });
      expect((await prisma.platformSetting.findUniqueOrThrow({ where: { name: "seatCeiling" } })).value).toBe(50);
      expect(await prisma.catalogChange.findFirstOrThrow({ where: { entity: "platform_setting", entityId: "seatCeiling" } })).toMatchObject({ changedBy: adminId, before: 100, after: 50 });
      const [audit] = await prisma.adminAuditLog.findMany({ where: { resource: "platform_setting" }, orderBy: { createdAt: "asc" } });
      expect(audit).toMatchObject({ adminId, action: "update", reason: "lower the ceiling", before: { name: "seatCeiling", value: 100 }, after: { name: "seatCeiling", value: 50 } });
    });
  });

  describe("AC2: an admin without the permission is refused on every write and nothing is written", () => {
    it.each(WRITE_LABELS)("%s: viewer (read only) gets 403, no change and no audit row", async (label) => {
      const { cookie } = await signedIn("viewer");
      const f = await createFixture();
      const [, method, url, body] = routeOf(f, label);
      const before = await catalogState();

      const res = await call(method, url, cookie, body);

      expect(res.statusCode).toBe(403);
      expect(await catalogState()).toEqual(before);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("PUT /admin/settings/:name: finance (packages:write, settings:read only) gets 403 and nothing changes", async () => {
      const { cookie } = await signedIn("finance");
      await prisma.platformSetting.create({ data: { name: "seatCeiling", value: 100 } });
      const before = await catalogState();

      const res = await call("PUT", "/admin/settings/seatCeiling", cookie, { value: 50, reason: "x" });

      expect(res.statusCode).toBe(403);
      expect(await catalogState()).toEqual(before);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it.each(WRITE_LABELS)("%s: control, owner gets 2xx and one audit row", async (label) => {
      const { cookie } = await signedIn("owner");
      const f = await createFixture();
      const [, method, url, body] = routeOf(f, label);

      const res = await call(method, url, cookie, body);

      expect([200, 201]).toContain(res.statusCode);
      expect(await prisma.adminAuditLog.count()).toBe(1);
    });
  });

  describe("D250: price and code writes need a recent re-authentication", () => {
    const REAUTH_LABELS = [
      "POST /admin/packages/:id/versions",
      "POST /admin/top-up-packs/:id/versions",
      "POST /admin/enterprise-bundles/:id/versions",
      "POST /admin/codes",
      "PATCH /admin/codes/:id",
    ];
    const staleReauth = () => new Date(Date.now() - (REAUTH_WINDOW_MINUTES + 1) * 60_000);
    const cases = REAUTH_LABELS.flatMap((label) => [
      [label, "never re-authenticated", null] as const,
      [label, `re-authenticated more than ${REAUTH_WINDOW_MINUTES} minutes ago`, "stale"] as const,
    ]);

    it.each(cases)("%s: owner %s gets 403, nothing is written and no audit row", async (label, _when, reauth) => {
      const { cookie } = await signedIn("owner", reauth === "stale" ? staleReauth() : null);
      const f = await createFixture();
      const [, method, url, body] = routeOf(f, label);
      const before = await catalogState();

      const res = await call(method, url, cookie, body);

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("Re-authentication required");
      expect(await catalogState()).toEqual(before);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it.each(WRITE_LABELS.filter((label) => !REAUTH_LABELS.includes(label)))("%s: needs no re-authentication (owner never re-authenticated gets 2xx)", async (label) => {
      const { cookie } = await signedIn("owner", null);
      const f = await createFixture();
      const [, method, url, body] = routeOf(f, label);

      const res = await call(method, url, cookie, body);

      expect([200, 201]).toContain(res.statusCode);
      expect(await prisma.adminAuditLog.count()).toBe(1);
    });
  });

  describe("AC3: an invalid version body or setting value is a 400 and nothing changes", () => {
    it.each([
      ["a negative price", { priceUsdCents: -1 }],
      ["a price that is not an integer (cents)", { priceUsdCents: 10.5 }],
      ["a price as a string", { priceUsdCents: "1500" }],
      ["no reason", { reason: undefined }],
      ["a blank reason", { reason: "   " }],
      ["no effective date", { effectiveFrom: undefined }],
      ["an effective date that is not a date-time", { effectiveFrom: "next monday" }],
      ["an empty allowedTiers", { allowedTiers: [] }],
      ["an unknown tier", { allowedTiers: ["ultra"] }],
      ["an unknown field", { discount: 10 }],
    ])("package version with %s", async (_label, change) => {
      const { cookie } = await signedIn("owner");
      const f = await createFixture();
      const before = await catalogState();

      const res = await call("POST", `/admin/packages/${f.packageId}/versions`, cookie, { ...STARTER_TERMS, reason: "r", effectiveFrom: now(), priceUsdCents: 1500, ...change });

      expect(res.statusCode).toBe(400);
      expect(await catalogState()).toEqual(before);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it.each([
      ["an unknown setting name", "noSuchSetting", { value: 1, reason: "r" }],
      ["a negative seat ceiling", "seatCeiling", { value: -1, reason: "r" }],
      ["a seat ceiling that is not an integer", "seatCeiling", { value: 1.5, reason: "r" }],
      ["a seat ceiling as a string", "seatCeiling", { value: "50", reason: "r" }],
      ["no value", "seatCeiling", { reason: "r" }],
      ["no reason", "seatCeiling", { value: 50 }],
      ["an anonymous IP cap of 0", "anonymousRequestsPerIpPerDay", { value: 0, reason: "r" }],
      ["a credit amount finer than a micro-credit", "weeklyFreeAllowanceCredits", { value: 0.0000001, reason: "r" }],
    ])("setting with %s", async (_label, name, body) => {
      const { cookie } = await signedIn("owner");
      await prisma.platformSetting.create({ data: { name: "seatCeiling", value: 100 } });
      const before = await catalogState();

      const res = await call("PUT", `/admin/settings/${name}`, cookie, body);

      expect(res.statusCode).toBe(400);
      expect(await catalogState()).toEqual(before);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });

  describe("AC4: the write and its audit row are one transaction", () => {
    it.each(WRITE_LABELS)("%s: the audit insert fails, 500, nothing is written, no audit row", async (label) => {
      const { cookie } = await signedIn("owner");
      const f = await createFixture();
      await prisma.platformSetting.create({ data: { name: "seatCeiling", value: 100 } });
      const [, method, url, body] = routeOf(f, label);
      const before = await catalogState();
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      jest.spyOn(AdminAuditLogRepository.prototype, "create").mockRejectedValueOnce(new Error("audit insert refused (test)"));

      const res = await call(method, url, cookie, body);

      expect(res.statusCode).toBe(500);
      expect(await catalogState()).toEqual(before);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });
});
