import { randomUUID } from "node:crypto";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminUsageModule } from "../admin-usage.module";
import { UsageAggregatesService } from "../service/usage-aggregates.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";
import { createProvider, createUser } from "../../../../test/factories";
import { seedAccount, seedCall, seedPackageVersion, seedPurchase } from "../../../../test/usage-seed";

// RNX-228: the usage, cost and profit reports and the provider reconciliation through real HTTP (Fastify `inject`), the
// real AccessGuard, audit hook and PrismaService on the test database. Made-up values only.

const ACCESS = "rx_admin_access";
const PERIOD = "from=2026-10-04&to=2026-10-06";
/** 10:00 Asia/Jakarta on 2026-10-05 (D1), and later that day. */
const D1 = (hour: number): string => `2026-10-05T${String(hour).padStart(2, "0")}:00:00Z`;
/** 2026-10-05T17:30Z is 00:30 on 2026-10-06 in Asia/Jakarta (D2): the day is the Jakarta day. */
const D2_EARLY = "2026-10-05T17:30:00Z";
const TOKENS = { new: 100, cached: 50, out: 20, reasoning: 5 };

type Json = Record<string, any>;

describe("Usage, cost and profit aggregates and reconciliation (RNX-228, Fastify, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminUsageModule] }));
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
  const setSetting = (name: string, value: number) =>
    moduleRef.get(PlatformSettingsService).saveSetting({ name, value, author: { changedBy: "test", reason: "RNX-228 test" } });

  /**
   * The scenario: providers P1 and P2 and calls without a provider record; user U1 (paid wallet, a package bought on D1
   * at Rp 165,000 / $10 for 100 credits: Rp 1,650 and $0.10 per credit), user U2 (weekly free wallet), a company pool.
   */
  const seedScenario = async () => {
    const { adminId } = await signedIn("owner");
    const p1 = (await createProvider(prisma, { createdByAdminId: adminId })).id;
    const p2 = (await createProvider(prisma, { createdByAdminId: adminId })).id;
    const u1 = (await createUser(prisma, { email: "u1-rnx228@example.com" })).id;
    const u2 = (await createUser(prisma)).id;
    const u1Paid = await seedAccount(prisma, { userId: u1, wallet: "paid" });
    const u2Free = await seedAccount(prisma, { userId: u2, wallet: "weekly_free" });
    const company = await seedAccount(prisma, { companyId: randomUUID(), wallet: "paid" });
    const packageVersionId = await seedPackageVersion(prisma, { priceUsdCents: 1000, credits: "100" });
    await seedPurchase(prisma, { buyerUserId: u1, accountId: u1Paid, packageVersionId, priceUsdCents: 1000, priceRupiah: 165000, credits: "100", at: D1(1) });
    const paid = { accountId: u1Paid, wallet: "paid" as const, memberUserId: u1, tokens: TOKENS };
    // c1, c2: P1 standard, paid, known cost; c2 in a workspace.
    await seedCall(prisma, { ...paid, credits: "2", at: D1(3), providerId: p1, model: "m-a", tier: "standard", cost: { lowUsd: "0.01", highUsd: "0.02", lowIdr: "165", highIdr: "330" } });
    await seedCall(prisma, { ...paid, credits: "3", at: D1(4), providerId: p1, model: "m-a", tier: "standard", workspaceId: "ws-1", tokens: { new: 200, cached: 0, out: 30, reasoning: null }, cost: { lowUsd: "0.03", highUsd: "0.03", lowIdr: "495", highIdr: "495" } });
    // c3: P2 premium, paid, cost unknown (USD and rupiah null).
    await seedCall(prisma, { ...paid, credits: "1", at: D1(5), providerId: p2, model: "m-b", tier: "premium", cost: { lowUsd: null, highUsd: null, lowIdr: null, highIdr: null } });
    // c4: P2 premium, weekly free wallet (no revenue), USD known, rupiah unknown (no rate).
    await seedCall(prisma, { accountId: u2Free, wallet: "weekly_free", memberUserId: u2, credits: "0.5", at: D1(6), providerId: p2, model: "m-b", tier: "premium", tokens: TOKENS, cost: { lowUsd: "0.005", highUsd: "0.005", lowIdr: null, highIdr: null } });
    // c5: no provider record, a company pool (no purchase snapshot: revenue unknown).
    await seedCall(prisma, { accountId: company, wallet: "paid", memberUserId: u1, credits: "4", at: D1(7), providerId: null, model: "m-fake", tier: "standard", tokens: TOKENS, cost: { lowUsd: "0.001", highUsd: "0.001", lowIdr: "16.5", highIdr: "16.5" } });
    // c6: P1 on D2 (00:30 Jakarta).
    await seedCall(prisma, { ...paid, credits: "1", at: D2_EARLY, providerId: p1, model: "m-a", tier: "standard", cost: { lowUsd: "0.01", highUsd: "0.01", lowIdr: "165", highIdr: "165" } });
    return { p1, p2, u1, u2, packageVersionId };
  };
  /** The row of `rows` with these dimension values. */
  const rowOf = (rows: Json[], match: Json): Json => {
    const found = rows.filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));
    expect(found).toHaveLength(1);
    return found[0];
  };

  describe("AC1, AC2: the totals equal the sums of model_call_costs and the ledger; null cost is unknown, not 0", () => {
    it("per day, provider, model, tier, wallet and package, in USD and rupiah; the same before and after the days are built", async () => {
      const { p1, p2, packageVersionId } = await seedScenario();
      const { cookie } = await signedIn("finance");

      const live = await get(cookie, `/admin/usage/profit?${PERIOD}`);
      const built = await moduleRef.get(UsageAggregatesService).buildClosedDays();
      const fromRollups = await get(cookie, `/admin/usage/profit?${PERIOD}`);

      expect(live.statusCode).toBe(200);
      expect(built).toEqual(expect.arrayContaining(["2026-10-05", "2026-10-06"]));
      expect(await prisma.usageDailyRollup.count()).toBeGreaterThan(0);
      expect(fromRollups.json()).toEqual(live.json());
      const { rows, totals, creditsSold, ppnRate, paymentGatewayFeePercent } = fromRollups.json();
      expect({ ppnRate, paymentGatewayFeePercent }).toEqual({ ppnRate: "0.11", paymentGatewayFeePercent: null });
      expect(rows).toHaveLength(5);
      // c1 + c2: 5 credits x Rp 1,650 / $0.10.
      expect(rowOf(rows, { day: "2026-10-05", providerId: p1 })).toMatchObject({
        providerModelId: "m-a", tier: "standard", wallet: "paid", packageVersionId, topUpPackVersionId: null, calls: 2, creditsConsumed: "5",
        costLowUsd: "0.04", costHighUsd: "0.05", costUnknownUsdCalls: 0, costLowIdr: "660", costHighIdr: "825", costUnknownIdrCalls: 0,
        revenueIdr: "8250", revenueUsd: "0.5", revenueUnknownCalls: 0,
      });
      // AC2: c3's cost is null in USD and rupiah: counted as unknown, the sums hold no figure for it.
      expect(rowOf(rows, { day: "2026-10-05", providerId: p2, wallet: "paid" })).toMatchObject({
        calls: 1, costLowUsd: "0", costHighUsd: "0", costUnknownUsdCalls: 1, costLowIdr: "0", costUnknownIdrCalls: 1, revenueIdr: "1650",
      });
      // AC2: c4's rupiah cost is null (no rate): unknown in rupiah only. A free wallet earns no revenue.
      expect(rowOf(rows, { day: "2026-10-05", providerId: p2, wallet: "weekly_free" })).toMatchObject({
        calls: 1, creditsConsumed: "0", costLowUsd: "0.005", costUnknownUsdCalls: 0, costLowIdr: "0", costUnknownIdrCalls: 1, revenueIdr: "0", revenueUnknownCalls: 0,
      });
      // No provider record, a company pool: no snapshot to price it, so revenue unknown (4 credits).
      expect(rowOf(rows, { day: "2026-10-05", providerId: "no provider record" })).toMatchObject({
        providerModelId: "m-fake", packageVersionId: null, calls: 1, revenueIdr: "0", revenueUnknownCalls: 1, revenueUnknownCredits: "4", costLowIdr: "16.5",
      });
      // c6 is on the Jakarta day 2026-10-06.
      expect(rowOf(rows, { day: "2026-10-06", providerId: p1 })).toMatchObject({ calls: 1, creditsConsumed: "1", revenueIdr: "1650", costLowUsd: "0.01" });
      expect(totals).toMatchObject({
        calls: 6, creditsConsumed: "11", costLowUsd: "0.056", costHighUsd: "0.066", costUnknownUsdCalls: 1,
        costLowIdr: "841.5", costHighIdr: "1006.5", costUnknownIdrCalls: 2, revenueIdr: "11550", revenueUsd: "0.7",
        revenueUnknownCalls: 1, revenueUnknownCredits: "4", freeWalletCalls: 1, freeWalletCostLowUsd: "0.005", freeWalletCostLowIdr: "0",
      });
      expect(creditsSold).toEqual({
        label: "list value, not cash",
        rows: [{ day: "2026-10-05", packageVersionId, topUpPackVersionId: null, entries: 1, creditsSold: "100", listValueIdr: "165000", listValueUsd: "10" }],
      });
    });

    it("the totals equal sums computed straight from model_call_costs and the ledger (independent SQL)", async () => {
      await seedScenario();
      await moduleRef.get(UsageAggregatesService).buildClosedDays();
      const { cookie } = await signedIn("owner");

      const { totals } = (await get(cookie, `/admin/usage/profit?${PERIOD}`)).json();

      const [raw] = await prisma.$queryRaw<Json[]>`
        SELECT count(*)::int AS calls,
          sum(c.cost_low_usd)::text AS low_usd, sum(c.cost_high_usd)::text AS high_usd,
          sum(c.cost_low_idr)::text AS low_idr, sum(c.cost_high_idr)::text AS high_idr,
          (-sum(e.amount) FILTER (WHERE c.wallet = 'paid'))::text AS credits
        FROM model_call_costs c JOIN credit_ledger_entries e ON e.call_id = c.call_id AND e.type = 'usage'`;
      expect(totals.calls).toBe(raw.calls);
      expect(Number(totals.costLowUsd)).toBeCloseTo(Number(raw.low_usd), 12);
      expect(Number(totals.costHighUsd)).toBeCloseTo(Number(raw.high_usd), 12);
      expect(Number(totals.costLowIdr)).toBeCloseTo(Number(raw.low_idr), 9);
      expect(Number(totals.costHighIdr)).toBeCloseTo(Number(raw.high_idr), 9);
      expect(Number(totals.creditsConsumed)).toBeCloseTo(Number(raw.credits), 6);
    });
  });

  describe("AC8: two API instances run the daily job at the same time", () => {
    type RollupLocks = { held: number; waiting: number };
    /** The rollup job's advisory locks (first key 228001) in this database: held and waited for. */
    const rollupLocks = async (): Promise<RollupLocks> => {
      const [locks] = await prisma.$queryRaw<RollupLocks[]>`
        SELECT count(*) FILTER (WHERE l.granted)::int AS held, count(*) FILTER (WHERE NOT l.granted)::int AS waiting
        FROM pg_locks l JOIN pg_database d ON d.oid = l.database
        WHERE l.locktype = 'advisory' AND l.classid = 228001 AND d.datname = current_database()`;
      return locks;
    };
    /** Polls the rollup locks until `isReached` holds, for at most 5 s; whether it was reached. */
    const waitForLocks = async (isReached: (locks: RollupLocks) => boolean): Promise<boolean> => {
      for (let i = 0; i < 100; i++) {
        if (isReached(await rollupLocks())) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };

    it("the second instance waits on the advisory lock the first holds, then skips that day: each day is built once", async () => {
      await seedScenario();
      const { cookie } = await signedIn("finance");
      const aggregates = moduleRef.get(UsageAggregatesService);
      const jobs: Promise<string[]>[] = [];
      const reached: boolean[] = [];

      // The test holds a SHARE lock on usage_daily_rollups, so instance A stops at its first INSERT while it holds the
      // advisory lock of its first day; instance B, started then, must wait on that advisory lock.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`LOCK TABLE usage_daily_rollups IN SHARE MODE`;
        jobs.push(aggregates.buildClosedDays());
        reached.push(await waitForLocks(({ held }) => held === 1));
        jobs.push(aggregates.buildClosedDays());
        reached.push(await waitForLocks(({ held, waiting }) => held === 1 && waiting === 1));
      }, { timeout: 25_000 });
      const settled = await Promise.allSettled(jobs);

      expect(reached).toEqual([true, true]);
      expect(settled.map((job) => (job.status === "rejected" ? String(job.reason) : job.status))).toEqual(["fulfilled", "fulfilled"]);
      const [first, second] = settled.map((job) => (job.status === "fulfilled" ? job.value : []));
      const builtDays = (await prisma.usageRollupDay.findMany()).map((row) => row.day.toISOString().slice(0, 10)).sort();
      expect(builtDays).toEqual(expect.arrayContaining(["2026-10-05", "2026-10-06"]));
      expect([...first, ...second].sort()).toEqual(builtDays);
      expect(first).toContain("2026-10-05");
      expect(second).not.toContain("2026-10-05");
      const { totals } = (await get(cookie, `/admin/usage/profit?${PERIOD}`)).json();
      expect(totals).toMatchObject({ calls: 6, creditsConsumed: "11", costLowUsd: "0.056" });
    });
  });

  describe("AC3: cost, revenue, profit and margin need profit:read; token counts need usage:read", () => {
    it.each([["finance"], ["owner"]])("%s: profit 200 and daily 200", async (role) => {
      const { cookie } = await signedIn(role);

      expect((await get(cookie, `/admin/usage/profit?${PERIOD}`)).statusCode).toBe(200);
      expect((await get(cookie, `/admin/usage/daily?${PERIOD}`)).statusCode).toBe(200);
      expect((await get(cookie, `/admin/reconciliation?${PERIOD}`)).statusCode).toBe(200);
    });

    it("viewer: token counts 200; profit and the reconciliation report 403 (negative)", async () => {
      await seedScenario();
      const { cookie } = await signedIn("viewer");

      const daily = await get(cookie, `/admin/usage/daily?${PERIOD}`);

      expect(daily.statusCode).toBe(200);
      expect(daily.json().rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(daily.json())).not.toMatch(/cost|revenue|profit|margin/i);
      expect((await get(cookie, `/admin/usage/profit?${PERIOD}`)).statusCode).toBe(403);
      expect((await get(cookie, `/admin/reconciliation?${PERIOD}`)).statusCode).toBe(403);
    });

    it("a custom role holding only usage:read: daily 200, profit 403 (negative)", async () => {
      const { cookie } = await signedIn("usage-only", ["usage:read"]);

      expect((await get(cookie, `/admin/usage/daily?${PERIOD}`)).statusCode).toBe(200);
      expect((await get(cookie, `/admin/usage/profit?${PERIOD}`)).statusCode).toBe(403);
    });

    it("a period over 92 days or with to before from: 400", async () => {
      const { cookie } = await signedIn("finance");

      expect((await get(cookie, "/admin/usage/profit?from=2026-01-01&to=2026-06-01")).statusCode).toBe(400);
      expect((await get(cookie, "/admin/usage/daily?from=2026-10-05&to=2026-10-04")).statusCode).toBe(400);
    });

    it("the usage report: token counts per day, provider, model, tier and workspace or user", async () => {
      const { p1, u1 } = await seedScenario();
      const { cookie } = await signedIn("viewer");

      const { rows } = (await get(cookie, `/admin/usage/daily?${PERIOD}`)).json();

      expect(rowOf(rows, { day: "2026-10-05", providerId: p1, workspaceId: null })).toMatchObject({
        user: { id: u1, email: "***" }, calls: 1, tokensNew: "100", tokensCached: "50", tokensOut: "20", tokensReasoning: "5",
      });
      expect(rowOf(rows, { day: "2026-10-05", providerId: p1, workspaceId: "ws-1" })).toMatchObject({ user: null, calls: 1, tokensNew: "200", tokensReasoning: "0" });
    });
  });

  describe("AC6: the gateway fee setting changes the net margin", () => {
    it("fee 2% then 5%: PPN 11/111 of the gross, then the fee, then profit / net revenue", async () => {
      const { p1 } = await seedScenario();
      const { cookie } = await signedIn("finance");
      const report = async () => rowOf((await get(cookie, `/admin/usage/profit?${PERIOD}`)).json().rows, { day: "2026-10-05", providerId: p1 });

      const unset = await report();
      await setSetting("paymentGatewayFeePercent", 2);
      const atTwo = await report();
      await setSetting("paymentGatewayFeePercent", 5);
      const atFive = await report();

      // Gross Rp 8,250: PPN 817.567567..., fee 165 (2%) or 412.5 (5%); cost Rp 660 to 825.
      expect(unset).toMatchObject({ ppnIdr: expect.stringMatching(/^817\.5675675675/), gatewayFeeIdr: null, netRevenueIdr: null, netMarginLow: null, netMarginHigh: null });
      expect(atTwo).toMatchObject({ gatewayFeeIdr: "165", netMarginLow: "0.88648", netMarginHigh: "0.909184" });
      expect(Number(atTwo.netRevenueIdr)).toBeCloseTo(8250 - 8250 * 0.11 / 1.11 - 165, 9);
      expect(Number(atTwo.profitLowIdr)).toBeCloseTo(8250 - 8250 * 0.11 / 1.11 - 165 - 825, 9);
      expect(atFive).toMatchObject({ gatewayFeeIdr: "412.5", netMarginLow: "0.882478", netMarginHigh: "0.905982" });
      expect(Number(atFive.netMarginLow)).toBeLessThan(Number(atTwo.netMarginLow));
    });
  });

  describe("AC7: a user's email is masked; revealing it needs users:read_pii", () => {
    const reveal = (cookie: string, userId: string, payload: Json = { reason: "ticket 4711: usage question" }) =>
      post(cookie, `/admin/usage/users/${userId}/email`, payload);
    const revealRows = () => prisma.adminAuditLog.findMany({ where: { resource: "user_pii", action: "reveal" } });

    it("the usage report shows the user id and the email masked", async () => {
      const { u1 } = await seedScenario();
      const { cookie } = await signedIn("owner");

      const body = (await get(cookie, `/admin/usage/daily?${PERIOD}`)).json();

      expect(JSON.stringify(body)).not.toContain("u1-rnx228@example.com");
      expect(body.rows.filter((row: Json) => row.user?.id === u1).every((row: Json) => row.user.email === "***")).toBe(true);
    });

    it.each([
      ["viewer (usage:read, no users:read_pii)", "viewer", undefined],
      ["operations (users:read_pii, no usage:read)", "operations", undefined],
      ["a custom role with only usage:read", "usage-reader", ["usage:read"]],
      ["a custom role with only users:read_pii", "pii-reader", ["users:read_pii"]],
    ])("%s: 403, no audit row (negative)", async (_case, role, permissions) => {
      const { u1 } = await seedScenario();
      const { cookie } = await signedIn(role, permissions);

      const res = await reveal(cookie, u1);

      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.json())).not.toContain("u1-rnx228@example.com");
      expect(await revealRows()).toEqual([]);
    });

    it("control: a custom role with usage:read and users:read_pii, and owner: 200 with the email; an audit row with the reason", async () => {
      const { u1 } = await seedScenario();
      const custom = await signedIn("usage-pii", ["usage:read", "users:read_pii"]);
      const owner = await signedIn("owner");

      const first = await reveal(custom.cookie, u1);
      const second = await reveal(owner.cookie, u1);

      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ userId: u1, email: "u1-rnx228@example.com" });
      expect(second.statusCode).toBe(200);
      const rows = await revealRows();
      expect(rows.map((row) => row.adminId).sort()).toEqual([custom.adminId, owner.adminId].sort());
      expect(rows[0]).toMatchObject({ reason: "ticket 4711: usage question", before: { userId: u1, revealed: false }, after: { userId: u1, revealed: true } });
    });

    it("without a reason: 400; an unknown user: 404; no audit row", async () => {
      const { cookie } = await signedIn("owner");
      const { u1 } = await seedScenario();

      expect((await reveal(cookie, u1, {})).statusCode).toBe(400);
      expect((await reveal(cookie, randomUUID())).statusCode).toBe(404);
      expect(await revealRows()).toEqual([]);
    });
  });

  describe("AC4, AC5: reconciliation entries and the drift flag", () => {
    const enter = (cookie: string, payload: Json) => post(cookie, "/admin/reconciliation/entries", payload);
    const auditRows = () => prisma.adminAuditLog.findMany({ where: { resource: "provider_reconciliation", action: "record" } });

    it.each([["support"], ["viewer"]])("%s: 403, nothing stored, no audit row (negative)", async (role) => {
      const { p1 } = await seedScenario();
      const { cookie } = await signedIn(role);

      const res = await enter(cookie, { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9" });

      expect(res.statusCode).toBe(403);
      expect(await prisma.providerReconciliationEntry.count()).toBe(0);
      expect(await auditRows()).toEqual([]);
    });

    it("finance: stored for the named provider, with an audit entry naming the admin", async () => {
      const { p1 } = await seedScenario();
      const { adminId, cookie } = await signedIn("finance");

      const res = await enter(cookie, { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9", topUpUsd: "5" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9", topUpUsd: "5", enteredByAdminId: adminId });
      const stored = await prisma.providerReconciliationEntry.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ providerId: p1, enteredByAdminId: adminId });
      const [audit] = await auditRows();
      expect(audit).toMatchObject({ adminId, before: { providerId: p1, portalBalanceUsd: null }, after: { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9", topUpUsd: "5" } });
    });

    it.each([
      ["without a provider", { day: "2026-10-05", portalBalanceUsd: "99.9" }],
      ["with an unknown provider record", { providerId: randomUUID(), day: "2026-10-05", portalBalanceUsd: "99.9" }],
      ["with a JSON number as the balance", { providerId: "set below", day: "2026-10-05", portalBalanceUsd: 99.9 }],
    ])("an entry %s: 400, nothing stored (negative)", async (_case, payload: Json) => {
      const { p1 } = await seedScenario();
      const { cookie } = await signedIn("finance");

      const res = await enter(cookie, payload.providerId === "set below" ? { ...payload, providerId: p1 } : payload);

      expect(res.statusCode).toBe(400);
      expect(await prisma.providerReconciliationEntry.count()).toBe(0);
      expect(await auditRows()).toEqual([]);
    });

    it("two providers: the one whose portal drop is above its high estimate by more than the threshold is flagged, the other not", async () => {
      const { p1, p2 } = await seedScenario();
      const { cookie } = await signedIn("finance");
      await setSetting("reconciliationDriftThresholdPercent", 10);
      // P1 on D1: high estimate $0.05 (c1 + c2); limit 0.05 x 1.1 = 0.055; drop 100 - 99.9 = 0.1: flagged.
      // P2 on D1: high estimate $0.005 (c4; c3 unknown); limit 0.0055; drop 50 + 10 - 59.995 = 0.005: not flagged.
      for (const entry of [
        { providerId: p1, day: "2026-10-04", portalBalanceUsd: "100" },
        { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9" },
        { providerId: p2, day: "2026-10-04", portalBalanceUsd: "50" },
        { providerId: p2, day: "2026-10-05", portalBalanceUsd: "59.995", topUpUsd: "10" },
      ]) expect((await enter(cookie, entry)).statusCode).toBe(200);

      const { rows, driftThresholdPercent } = (await get(cookie, "/admin/reconciliation?from=2026-10-05&to=2026-10-05")).json();

      expect(driftThresholdPercent).toBe(10);
      expect(rowOf(rows, { providerId: p1 })).toMatchObject({ previousBalanceUsd: "100", portalDropUsd: "0.1", estimateLowUsd: "0.04", estimateHighUsd: "0.05", flagged: true });
      expect(rowOf(rows, { providerId: p2 })).toMatchObject({ previousBalanceUsd: "50", portalDropUsd: "0.005", estimateHighUsd: "0.005", costUnknownCalls: 1, flagged: false });
    });

    it("control: P1's drop within range (re-entered as 0.05) is not flagged; without the previous day nothing is flagged", async () => {
      const { p1 } = await seedScenario();
      const { cookie } = await signedIn("finance");
      await setSetting("reconciliationDriftThresholdPercent", 10);
      await enter(cookie, { providerId: p1, day: "2026-10-04", portalBalanceUsd: "100" });
      await enter(cookie, { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9" });
      await enter(cookie, { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.95" });
      await enter(cookie, { providerId: p1, day: "2026-10-06", portalBalanceUsd: "99" });

      const { rows } = (await get(cookie, "/admin/reconciliation?from=2026-10-05&to=2026-10-06")).json();

      expect(await prisma.providerReconciliationEntry.count()).toBe(3);
      expect(rowOf(rows, { day: "2026-10-05" })).toMatchObject({ portalDropUsd: "0.05", estimateHighUsd: "0.05", flagged: false });
      expect(rowOf(rows, { day: "2026-10-06" })).toMatchObject({ portalDropUsd: "0.95", flagged: true });
      const { rows: alone } = (await get(cookie, "/admin/reconciliation?from=2026-10-04&to=2026-10-04")).json();
      expect(alone).toEqual([expect.objectContaining({ previousBalanceUsd: null, portalDropUsd: null, flagged: null })]);
    });

    it("the threshold not set (its value is pending, no default): the drop is shown, the threshold and the flag are null", async () => {
      const { p1 } = await seedScenario();
      const { cookie } = await signedIn("finance");
      await enter(cookie, { providerId: p1, day: "2026-10-04", portalBalanceUsd: "100" });
      await enter(cookie, { providerId: p1, day: "2026-10-05", portalBalanceUsd: "99.9" });

      const { rows, driftThresholdPercent } = (await get(cookie, "/admin/reconciliation?from=2026-10-05&to=2026-10-05")).json();

      expect(driftThresholdPercent).toBeNull();
      expect(rowOf(rows, { providerId: p1 })).toMatchObject({ portalDropUsd: "0.1", estimateHighUsd: "0.05", flagged: null });
    });
  });
});
