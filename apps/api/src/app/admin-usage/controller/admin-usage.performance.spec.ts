import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { AdminAuthModule } from "../../admin-auth/admin-auth.module";
import { AdminSessionService } from "../../admin-auth/service/admin-session.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminUsageModule } from "../admin-usage.module";
import { UsageAggregatesService } from "../service/usage-aggregates.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { BACK_OFFICE_ORIGIN, createAdmin } from "../../../../test/admin-auth";
import { createProvider, createUser } from "../../../../test/factories";
import { seedPackageVersion } from "../../../../test/usage-seed";

// RNX-228 AC9: 100,000 model calls (cost rows and usage entries) over 30 closed days; a 30-day read of the profit and
// the usage reports answers within 500 ms from the rollups. The control reads the same period with the days not built
// (usage_rollup_days emptied, so every day is computed live from the raw rows) and shows that path over the budget.

const CALLS = 100_000;
const USERS = 20;
const BUDGET_MS = 500;
const RUNS = 5;
const PERIOD = "from=2026-09-01&to=2026-09-30";

describe("RNX-228 AC9: a 30-day read of 100,000 calls answers from the aggregates within 500 ms (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let cookie: string;

  /** Each run's milliseconds for GET `url`, all answered 200. */
  const time = async (url: string): Promise<number[]> => {
    const runs: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      const res = await app.inject({ method: "GET", url, headers: { ...BACK_OFFICE_ORIGIN, cookie } });
      runs.push(Math.round(performance.now() - started));
      expect(res.statusCode).toBe(200);
    }
    return runs;
  };

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ imports: [AdminAuthModule, AdminUsageModule] }));
    app = await createFastifyApp(moduleRef);
    await resetDatabase(prisma);
    const admin = await createAdmin(prisma, moduleRef, { email: `finance-${randomUUID().slice(0, 6)}@example.com`, role: "finance" });
    cookie = `rx_admin_access=${(await moduleRef.get(AdminSessionService).start(admin.id, "full", "jest")).accessToken}`;
    const providers = await Promise.all([1, 2, 3].map(() => createProvider(prisma, { createdByAdminId: admin.id })));
    const versionId = await seedPackageVersion(prisma, { priceUsdCents: 1000, credits: "100" });
    for (let i = 0; i < USERS; i += 1) {
      const user = await createUser(prisma);
      await prisma.$executeRaw`
        INSERT INTO credit_accounts (id, user_id, wallet, balance, updated_at) VALUES (${`acct-${i}`}, ${user.id}, 'paid', 1000, now())`;
      await prisma.$executeRaw`
        INSERT INTO purchase_snapshots (id, buyer_user_id, package_version_id, price_usd_cents, exchange_rate, exchange_rate_date, exchange_rate_source,
          price_rupiah, credits_granted, allowed_channels, allowed_tiers, payment_id, created_at)
        VALUES (${randomUUID()}, ${user.id}, ${versionId}, 1000, 16500, '2026-08-01', 'test', 165000, 100, ARRAY[]::text[], ARRAY[]::text[], ${`pay-${i}`}, '2026-08-01T00:00:00Z')`;
    }
    const providerIds = providers.map((provider) => provider.id);
    // Calls g = 1..100,000: the Jakarta day 2026-09-01 + (g % 30), account g % 20, provider g % 4 (3 = no provider record),
    // model g % 6, tier g % 3, a workspace on every third call, an unknown cost on every 50th.
    await prisma.$executeRaw`
      INSERT INTO credit_ledger_entries (id, account_id, wallet, seq, type, amount, balance_after, member_user_id, request_id, call_id, model_id, tier,
        rate_new, rate_cached, rate_out, tokens_new, tokens_cached, tokens_out, outcome, idempotency_key, created_at)
      SELECT gen_random_uuid()::text, 'acct-' || (g % ${USERS}), 'paid', g, 'usage', -0.5, 0, a.user_id, 'req-' || g, 'call-' || g,
        'model-' || (g % 6), (ARRAY['standard', 'advanced', 'premium'])[g % 3 + 1], 1, 1, 1, 100, 10, 20, 'completed', 'call-' || g,
        TIMESTAMPTZ '2026-08-31 17:00:00+00' + make_interval(days => g % 30, secs => (g * 7) % 86399)
      FROM generate_series(1, ${CALLS}) AS g JOIN credit_accounts a ON a.id = 'acct-' || (g % ${USERS})`;
    await prisma.$executeRaw`
      INSERT INTO model_call_costs (id, call_id, provider_id, provider_model_id, tokens_new, tokens_cached, tokens_out, tokens_reasoning,
        cost_low_usd, cost_high_usd, cost_low_idr, cost_high_idr, wallet, workspace_id, tier, created_at)
      SELECT gen_random_uuid()::text, 'call-' || g, (${providerIds}::text[])[g % 4 + 1], 'model-' || (g % 6), 100, 10, 20, NULL,
        CASE WHEN g % 50 = 0 THEN NULL ELSE 0.0012 END, CASE WHEN g % 50 = 0 THEN NULL ELSE 0.0018 END,
        CASE WHEN g % 50 = 0 THEN NULL ELSE 19.8 END, CASE WHEN g % 50 = 0 THEN NULL ELSE 29.7 END, 'paid',
        CASE WHEN g % 3 = 0 THEN 'ws-' || (g % 5) END, (ARRAY['standard', 'advanced', 'premium'])[g % 3 + 1],
        TIMESTAMPTZ '2026-08-31 17:00:00+00' + make_interval(days => g % 30, secs => (g * 7) % 86399)
      FROM generate_series(1, ${CALLS}) AS g`;
    await prisma.$executeRaw`ANALYZE`;
  }, 120_000);

  afterAll(() => app?.close());

  it("seeded: 100,000 cost rows and 100,000 usage entries over 30 days", async () => {
    const [counts] = await prisma.$queryRaw<{ costs: number; entries: number; days: number }[]>`
      SELECT (SELECT count(*)::int FROM model_call_costs) AS costs,
        (SELECT count(*)::int FROM credit_ledger_entries WHERE type = 'usage') AS entries,
        (SELECT count(DISTINCT (created_at AT TIME ZONE 'Asia/Jakarta')::date)::int FROM model_call_costs) AS days`;

    console.log(`[RNX-228 AC9] seed: ${counts.costs} model_call_costs rows, ${counts.entries} usage entries, ${counts.days} days`);
    expect(counts).toEqual({ costs: CALLS, entries: CALLS, days: 30 });
  });

  it("after the rollup job: the 30-day profit and usage reads answer within 500 ms from the aggregates", async () => {
    const started = performance.now();
    const built = await moduleRef.get(UsageAggregatesService).buildClosedDays();
    console.log(`[RNX-228 AC9] rollup job: built ${built.filter((day) => day.startsWith("2026-09")).length} September days in ${Math.round(performance.now() - started)} ms`);

    const profit = await time(`/admin/usage/profit?${PERIOD}`);
    const usage = await time(`/admin/usage/daily?${PERIOD}`);

    console.log(`[RNX-228 AC9] from the rollups, GET /admin/usage/profit 30 days: ${profit.join(", ")} ms, max ${Math.max(...profit)} ms`);
    console.log(`[RNX-228 AC9] from the rollups, GET /admin/usage/daily 30 days: ${usage.join(", ")} ms, max ${Math.max(...usage)} ms`);
    expect(Math.max(...profit)).toBeLessThan(BUDGET_MS);
    expect(Math.max(...usage)).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it("control: the same days un-built again (read live from the raw rows): the same 30-day profit read is over 500 ms", async () => {
    expect(await prisma.$executeRaw`DELETE FROM usage_rollup_days WHERE day BETWEEN '2026-09-01' AND '2026-09-30'`).toBe(30);

    const runs = await time(`/admin/usage/profit?${PERIOD}`);

    console.log(`[RNX-228 AC9] control, live from raw rows, GET /admin/usage/profit 30 days: ${runs.join(", ")} ms, max ${Math.max(...runs)} ms`);
    expect(Math.max(...runs)).toBeGreaterThan(BUDGET_MS);
  }, 120_000);
});
