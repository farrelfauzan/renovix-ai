import { createHmac, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { TestingModule } from "@nestjs/testing";
import type { PrismaService } from "../src/app/prisma/prisma.service";
import { AdminAuthModule } from "../src/app/admin-auth/admin-auth.module";
import { PAYMENT_PROVIDER } from "../src/app/payments/config/payment-provider.token";
import { PaymentsModule } from "../src/app/payments/payments.module";
import type { PaymentProvider } from "../src/app/payments/types/payment-provider";
import { createFastifyAdapter } from "../src/common/utils/create-fastify-adapter";
import { createTestModule } from "./test-module";

// Shared tooling of the payment specs (RNX-35). FakePaymentProvider, or AutoGoPay over a scripted transport (RNX-229):
// no network, no provider key, no money.
// Every value is an obviously fake test value; the limits are test values, not the Tech Lead's.

/** The fake provider's webhook signing key in tests; never a real key. */
export const TEST_WEBHOOK_SECRET = "rx35-test-only-fake-webhook-key-not-a-real-secret";
/** The test exchange rate: USD 1 = Rp16.500, so $10.00 = Rp165.000 and $5.00 = Rp82.500 -> Rp83.000 (rounded up to Rp1.000). */
export const TEST_RATE = "16500";
export const STARTER_PRICE_RUPIAH = 165_000;
export const PACK_PRICE_RUPIAH = 83_000;
/** The payment settings a test starts with (paymentsEnabled on, every limit set). */
export const TEST_PAYMENT_SETTINGS = {
  paymentsEnabled: true,
  paymentsMaxPerPaymentRupiah: 2_000_000,
  paymentsMaxPerAccountPerDayRupiah: 5_000_000,
  paymentsMaxPlatformPerDayRupiah: 50_000_000,
  paymentsOrderExpiryMinutes: 15,
  paymentsReconcileEveryMinutes: 5,
} as const;

/** The session cookie the mocked better-auth reads: its value is the user id (see `sessionFromCookie`). */
export const sessionCookie = (userId: string): string => `rx35_session=${userId}`;

/** The mocked `auth.api.getSession`: a user for a `rx35_session` cookie, null otherwise. */
export function sessionFromCookie({ headers }: { headers: Headers }): { user: { id: string; email: string }; session: { id: string } } | null {
  const match = /rx35_session=([^;]+)/.exec(headers.get("cookie") ?? "");
  return match ? { user: { id: match[1], email: `${match[1]}@example.test` }, session: { id: `s-${match[1]}` } } : null;
}

/**
 * The payments module (and the back-office auth for the admin routes) on the test database with this provider (the fake,
 * or AutoGoPay over a scripted transport, RNX-229), as a Fastify app with the raw body kept (as main.ts does).
 */
export async function createPaymentsApp(fake: PaymentProvider, imports: unknown[] = []) {
  const { moduleRef, prisma } = await createTestModule(
    { imports: [PaymentsModule, AdminAuthModule, ...(imports as [])] },
    (builder) => builder.overrideProvider(PAYMENT_PROVIDER).useValue(fake),
  );
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(), { rawBody: true });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { moduleRef: moduleRef as TestingModule, prisma, app };
}

/** Writes the payment settings (TEST_PAYMENT_SETTINGS, with overrides; `undefined` leaves one unset). */
export async function seedPaymentSettings(prisma: PrismaService, overrides: Record<string, unknown> = {}): Promise<void> {
  const values: Record<string, unknown> = { ...TEST_PAYMENT_SETTINGS, ...overrides };
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    await prisma.platformSetting.upsert({ where: { name }, create: { name, value: value as never }, update: { value: value as never } });
  }
}

/** Stores a USD to IDR rate dated `rateDate` (today by default), fetched now, so no refresh is attempted. */
export function seedRate(prisma: PrismaService, rateDate: Date = new Date(new Date().toISOString().slice(0, 10))) {
  return prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate: TEST_RATE, rateDate, fetchedAt: new Date(), source: "frankfurter" } });
}

/** The catalog a checkout needs: Starter (one-time, $10, 100 credits), a monthly package, and a top-up pack ($5, 40 credits). */
export async function seedPaymentCatalog(prisma: PrismaService) {
  const versionTerms = { maxAgents: 3, maxConnectedTools: 2, apiAccess: false, allowedChannels: ["web"], allowedTiers: ["standard"], createdBy: "test", reason: "RNX-35 test" };
  const starter = await prisma.package.create({ data: { name: `Starter-${randomUUID().slice(0, 6)}`, displayOrder: 1, active: true, visible: true } });
  const starterVersion = await prisma.packageVersion.create({
    data: { packageId: starter.id, versionNumber: 1, priceUsdCents: 1000, creditsGranted: 100, billing: "one_time", ...versionTerms },
  });
  const monthly = await prisma.package.create({ data: { name: `Monthly-${randomUUID().slice(0, 6)}`, displayOrder: 2, active: true, visible: true } });
  await prisma.packageVersion.create({ data: { packageId: monthly.id, versionNumber: 1, priceUsdCents: 2000, creditsGranted: 200, billing: "monthly", ...versionTerms } });
  const pack = await prisma.topUpPack.create({ data: { name: `Pack-${randomUUID().slice(0, 6)}`, active: true } });
  const packVersion = await prisma.topUpPackVersion.create({
    data: { packId: pack.id, versionNumber: 1, priceUsdCents: 500, creditsGranted: 40, createdBy: "test", reason: "RNX-35 test" },
  });
  return { starterId: starter.id, starterVersionId: starterVersion.id, monthlyId: monthly.id, packId: pack.id, packVersionId: packVersion.id };
}

/** The hex HMAC-SHA256 of the raw body under `secret`: what the fake provider expects in x-fake-signature. */
export const fakeSignature = (raw: string, secret: string = TEST_WEBHOOK_SECRET): string => createHmac("sha256", secret).update(raw).digest("hex");

/** A fake webhook body for the order's reference. */
export const fakeWebhookBody = (reference: string, status = "paid", amountRupiah: number | null = null): string =>
  JSON.stringify({ reference, status, amountRupiah });

/** HTTP helpers on the payments app (routes have no /api/v1 prefix in tests). */
export const paymentsHttp = (app: NestFastifyApplication) => ({
  checkout: (userId: string, payload: object) =>
    app.inject({ method: "POST", url: "/payments/checkout", headers: { cookie: sessionCookie(userId) }, payload }),
  getOrder: (userId: string, orderId: string) =>
    app.inject({ method: "GET", url: `/payments/orders/${orderId}`, headers: { cookie: sessionCookie(userId) } }),
  webhook: (raw: string, signature: string | null = fakeSignature(raw)) =>
    app.inject({
      method: "POST",
      url: "/webhooks/payments",
      headers: { "content-type": "application/json", ...(signature === null ? {} : { "x-fake-signature": signature }) },
      payload: raw,
    }),
});

/** The user's paid wallet balance as a string ("0" when the user has no account yet). */
export async function paidBalanceOf(prisma: PrismaService, userId: string): Promise<string> {
  const account = await prisma.creditAccount.findUnique({ where: { userId_wallet: { userId, wallet: "paid" } } });
  return account?.balance.toString() ?? "0";
}

/** A user with a package (an active subscription): may buy a top-up pack (D36). */
export async function givePackage(prisma: PrismaService, userId: string): Promise<void> {
  const plan = await prisma.subscriptionPlan.create({
    data: { slug: `plan-${randomUUID().slice(0, 8)}`, name: "plan", maxAgents: 1, maxIntegrations: 1, maxWorkspaceUsers: 1, maxTokensPerMonth: 1n, allowedChannels: ["web"] },
  });
  const now = Date.now();
  await prisma.userSubscription.create({
    data: { userId, planId: plan.id, currentPeriodStart: new Date(now), currentPeriodEnd: new Date(now + 30 * 86_400_000) },
  });
}
