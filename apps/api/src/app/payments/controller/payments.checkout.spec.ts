import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { FakePaymentProvider } from "../providers/fake-payment.provider";
import { PaymentOrderRepository } from "../repository/payment-order.repository";
import { createUser } from "../../../../test/factories";
import { resetDatabase } from "../../../../test/test-database";
import {
  PACK_PRICE_RUPIAH,
  STARTER_PRICE_RUPIAH,
  TEST_WEBHOOK_SECRET,
  createPaymentsApp,
  givePackage,
  paidBalanceOf,
  paymentsHttp,
  seedPaymentCatalog,
  seedPaymentSettings,
  seedRate,
  sessionFromCookie,
} from "../../../../test/payments";

// RNX-35a: checkout through real HTTP (Fastify inject), the real AccessGuard (better-auth's session lookup mocked:
// the cookie names the user), the real services and repositories on the test database, and FakePaymentProvider only.
// No network: fetch is stubbed (the rate is stored, never fetched). Made-up values only.
const mockGetSession = jest.fn();
jest.mock("../../../lib/auth", () => ({ auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } } }));

type Catalog = Awaited<ReturnType<typeof seedPaymentCatalog>>;

describe("RNX-35a checkout (Fastify, test database, fake provider)", () => {
  const fake = new FakePaymentProvider({ webhookSecret: TEST_WEBHOOK_SECRET, maxAmountRupiah: 10_000_000 });
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;
  let http: ReturnType<typeof paymentsHttp>;
  let catalog: Catalog;
  let createCharge: jest.SpyInstance;

  beforeAll(async () => {
    ({ moduleRef, prisma, app } = await createPaymentsApp(fake));
    http = paymentsHttp(app);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockGetSession.mockReset().mockImplementation(sessionFromCookie);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-35 test: no network"));
    createCharge = jest.spyOn(fake, "createCharge");
    catalog = await seedPaymentCatalog(prisma);
    await seedRate(prisma);
    await seedPaymentSettings(prisma);
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PAYMENTS_FORCE_OFF;
  });

  afterAll(() => app?.close());

  const buyStarter = (userId: string) => http.checkout(userId, { offer: "package", packageId: catalog.starterId });
  const buyPack = (userId: string) => http.checkout(userId, { offer: "top_up_pack", packId: catalog.packId });
  /** Nothing was ordered, charged or granted. */
  const expectNothingStarted = async () => {
    expect(createCharge).not.toHaveBeenCalled();
    expect(await prisma.paymentOrder.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  };

  describe("a checkout that goes through", () => {
    it("Starter: 201 with a pending order priced from the catalog (USD price x rate), its payment code and expiry; one provider call; no credits", async () => {
      const user = await createUser(prisma);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(201);
      const order = await prisma.paymentOrder.findFirstOrThrow();
      expect(res.json()).toEqual({
        orderId: order.id,
        offer: "package",
        state: "pending",
        amountRupiah: STARTER_PRICE_RUPIAH,
        expiresAt: order.expiresAt.toISOString(),
        paidAt: null,
        paymentCode: `fake-qris:fake_${order.id}`,
      });
      expect(order).toMatchObject({ userId: user.id, packageVersionId: catalog.starterVersionId, topUpPackVersionId: null, priceUsdCents: 1000, amountRupiah: STARTER_PRICE_RUPIAH, provider: "fake", providerRef: `fake_${order.id}`, status: "pending" });
      expect(order.exchangeRate.toString()).toBe("16500");
      expect(order.expiresAt.getTime() - order.createdAt.getTime()).toBeGreaterThan(14 * 60_000);
      expect(createCharge).toHaveBeenCalledTimes(1);
      expect(createCharge).toHaveBeenCalledWith(expect.objectContaining({ orderId: order.id, amountRupiah: STARTER_PRICE_RUPIAH }));
      expect(await prisma.paymentOrderChange.findMany({ select: { event: true, toStatus: true, source: true } })).toEqual([{ event: "created", toStatus: "pending", source: "checkout" }]);
      expect(await paidBalanceOf(prisma, user.id)).toBe("0");
    });

    it("AC10 (buyer states): the buyer reads their own pending order; credits never appear from a pending order; another user's order is 404", async () => {
      const [buyer, other] = [await createUser(prisma), await createUser(prisma)];
      const { orderId } = (await buyStarter(buyer.id)).json();

      const own = await http.getOrder(buyer.id, orderId);
      const foreign = await http.getOrder(other.id, orderId);
      const unknown = await http.getOrder(buyer.id, "00000000-0000-4000-8000-000000000000");

      expect(own.statusCode).toBe(200);
      expect(own.json()).toMatchObject({ orderId, state: "pending", amountRupiah: STARTER_PRICE_RUPIAH, paidAt: null });
      expect(foreign.statusCode).toBe(404);
      expect(unknown.statusCode).toBe(404);
      expect(await paidBalanceOf(prisma, buyer.id)).toBe("0");
    });

    it("a top-up pack for an account with a package: 201, priced Rp83.000 ($5.00 x 16500, rounded up)", async () => {
      const user = await createUser(prisma);
      await givePackage(prisma, user.id);

      const res = await buyPack(user.id);

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ offer: "top_up_pack", state: "pending", amountRupiah: PACK_PRICE_RUPIAH });
    });

    it("no session: 401 and nothing started", async () => {
      const res = await app.inject({ method: "POST", url: "/payments/checkout", payload: { offer: "package", packageId: catalog.starterId } });

      expect(res.statusCode).toBe(401);
      await expectNothingStarted();
    });

    it("a monthly package is not sold here: 400, nothing started", async () => {
      const user = await createUser(prisma);

      const res = await http.checkout(user.id, { offer: "package", packageId: catalog.monthlyId });

      expect(res.statusCode).toBe(400);
      await expectNothingStarted();
    });
  });

  describe("AC10 (D36): a free account may buy Starter or Pro only", () => {
    it("a free account starting a credit-pack checkout: 403, no order, no provider call", async () => {
      const user = await createUser(prisma);

      const res = await buyPack(user.id);

      expect(res.statusCode).toBe(403);
      expect(res.json().message).toBe("A top-up pack needs a package; buy Starter or Pro first");
      await expectNothingStarted();
    });

    it("a free account buying Pro (another one-time package): 201, allowed", async () => {
      const user = await createUser(prisma);
      const pro = await prisma.package.create({ data: { name: "Pro-rx35", displayOrder: 3, active: true, visible: true } });
      await prisma.packageVersion.create({
        data: { packageId: pro.id, versionNumber: 1, priceUsdCents: 2500, creditsGranted: 300, billing: "one_time", maxAgents: 5, maxConnectedTools: 5, apiAccess: true, allowedChannels: ["web"], allowedTiers: ["standard"], createdBy: "test", reason: "RNX-35 test" },
      });

      const res = await http.checkout(user.id, { offer: "package", packageId: pro.id });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ offer: "package", state: "pending" });
      expect(createCharge).toHaveBeenCalledTimes(1);
    });
  });

  describe("AC7: the kill switch", () => {
    it.each([
      ["paymentsEnabled false", async () => seedPaymentSettings(prisma, { paymentsEnabled: false })],
      ["paymentsEnabled not set", async () => prisma.platformSetting.delete({ where: { name: "paymentsEnabled" } })],
      ["PAYMENTS_FORCE_OFF=true with paymentsEnabled true", async () => void (process.env.PAYMENTS_FORCE_OFF = "true")],
    ])("%s: checkout answers 503 'payments are paused' with no order and no provider call", async (_case, switchOff) => {
      const user = await createUser(prisma);
      await switchOff();

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toBe("Payments are paused; use an invitation code");
      await expectNothingStarted();
    });
  });

  describe("AC8: limits name the limit and call no provider", () => {
    it.each([
      ["above paymentsMaxPerPaymentRupiah", { paymentsMaxPerPaymentRupiah: STARTER_PRICE_RUPIAH - 1 }, "paymentsMaxPerPaymentRupiah"],
      ["the account past its daily cap", { paymentsMaxPerAccountPerDayRupiah: STARTER_PRICE_RUPIAH - 1 }, "paymentsMaxPerAccountPerDayRupiah"],
      ["the platform past its daily cap", { paymentsMaxPlatformPerDayRupiah: STARTER_PRICE_RUPIAH - 1 }, "paymentsMaxPlatformPerDayRupiah"],
    ])("%s: 422 naming it, no order, no provider call", async (_case, settings, name) => {
      const user = await createUser(prisma);
      await seedPaymentSettings(prisma, settings);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(422);
      expect(res.json().message).toContain(name);
      await expectNothingStarted();
    });

    it("above the provider's own maximum: 422 naming it, no order, no provider call", async () => {
      const user = await createUser(prisma);
      const maxAmount = jest.replaceProperty(fake, "maxAmountRupiah", STARTER_PRICE_RUPIAH - 1);

      const res = await buyStarter(user.id);
      maxAmount.restore();

      expect(res.statusCode).toBe(422);
      expect(res.json().message).toContain("payment provider's maximum");
      await expectNothingStarted();
    });

    it("the daily caps count today's earlier pending orders: the account's second checkout past its cap is refused, another account's goes through", async () => {
      const [first, second] = [await createUser(prisma), await createUser(prisma)];
      await seedPaymentSettings(prisma, { paymentsMaxPerAccountPerDayRupiah: STARTER_PRICE_RUPIAH * 2 - 1 });

      const ok = await buyStarter(first.id);
      const refused = await buyStarter(first.id);
      const other = await buyStarter(second.id);

      expect([ok.statusCode, refused.statusCode, other.statusCode]).toEqual([201, 422, 201]);
      expect(refused.json().message).toContain("paymentsMaxPerAccountPerDayRupiah");
      expect(createCharge).toHaveBeenCalledTimes(2);
    });

    it("two checkouts of one account at the same moment against its daily cap: exactly one goes through (the checkout lock)", async () => {
      const user = await createUser(prisma);
      await seedPaymentSettings(prisma, { paymentsMaxPerAccountPerDayRupiah: STARTER_PRICE_RUPIAH * 2 - 1 });

      const results = await Promise.all([buyStarter(user.id), buyStarter(user.id)]);

      expect(results.map((res) => res.statusCode).sort()).toEqual([201, 422]);
      expect(await prisma.paymentOrder.count()).toBe(1);
      expect(createCharge).toHaveBeenCalledTimes(1);
    });

    it("the daily caps count today's paid orders and not failed ones", async () => {
      const user = await createUser(prisma);
      await seedPaymentSettings(prisma, { paymentsMaxPerAccountPerDayRupiah: STARTER_PRICE_RUPIAH * 2 - 1 });
      expect((await buyStarter(user.id)).statusCode).toBe(201);
      const order = await prisma.paymentOrder.findFirstOrThrow();
      await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date() } });

      const whilePaid = await buyStarter(user.id);
      await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "failed", paidAt: null } });
      const whileFailed = await buyStarter(user.id);

      expect([whilePaid.statusCode, whileFailed.statusCode]).toEqual([422, 201]);
      expect(whilePaid.json().message).toContain("paymentsMaxPerAccountPerDayRupiah");
    });

    it.each(["paymentsMaxPerPaymentRupiah", "paymentsMaxPerAccountPerDayRupiah", "paymentsMaxPlatformPerDayRupiah", "paymentsOrderExpiryMinutes"])(
      "%s not set: checkout is refused with 503 naming it, nothing started",
      async (name) => {
        const user = await createUser(prisma);
        await prisma.platformSetting.delete({ where: { name } });

        const res = await buyStarter(user.id);

        expect(res.statusCode).toBe(503);
        expect(res.json().message).toBe(`Payments are not configured: ${name} is not set`);
        await expectNothingStarted();
      },
    );
  });

  describe("AC9: the rate quote", () => {
    it.each([
      ["no rate stored", async () => prisma.exchangeRate.deleteMany()],
      ["the only rate is 8 days old", async () => {
        await prisma.exchangeRate.deleteMany();
        await seedRate(prisma, new Date(Date.now() - 8 * 86_400_000));
      }],
    ])("%s: 503 with no order, no transaction and no provider call", async (_case, breakRate) => {
      const user = await createUser(prisma);
      await breakRate();
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const run = jest.spyOn(moduleRef.get(TransactionService), "run");

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(503);
      expect(res.json().message).toBe("Prices are unavailable: no current USD to IDR exchange rate");
      expect(run).not.toHaveBeenCalled();
      await expectNothingStarted();
    });

    it("a valid rate: the quote is taken before the order's transaction opens", async () => {
      const user = await createUser(prisma);
      const quote = jest.spyOn(moduleRef.get(ExchangeRateService), "getPurchaseRate");
      const run = jest.spyOn(moduleRef.get(TransactionService), "run");

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(201);
      expect(quote).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalled();
      expect(quote.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
    });
  });

  describe("AC23: the pilot allow-list", () => {
    it("set: a listed account checks out; an unlisted one is refused with 403, no order, no provider call", async () => {
      const [listed, unlisted] = [await createUser(prisma), await createUser(prisma)];
      await seedPaymentSettings(prisma, { paymentsAllowedUserIds: [listed.id] });

      const refused = await buyStarter(unlisted.id);
      expect(refused.statusCode).toBe(403);
      await expectNothingStarted();
      const allowed = await buyStarter(listed.id);

      expect(allowed.statusCode).toBe(201);
      expect(createCharge).toHaveBeenCalledTimes(1);
    });

    it("empty: everyone may check out", async () => {
      const user = await createUser(prisma);
      await seedPaymentSettings(prisma, { paymentsAllowedUserIds: [] });

      expect((await buyStarter(user.id)).statusCode).toBe(201);
    });
  });

  describe("the provider refuses the charge", () => {
    it("502; the order is failed (audited), nothing granted; the buyer sees it failed", async () => {
      const user = await createUser(prisma);
      fake.failNextCharge();
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(502);
      const order = await prisma.paymentOrder.findFirstOrThrow();
      expect(order).toMatchObject({ status: "failed", providerRef: null });
      expect((await prisma.paymentOrderChange.findMany({ orderBy: { createdAt: "asc" } })).map((c) => c.event)).toEqual(["created", "charge_failed"]);
      expect((await http.getOrder(user.id, order.id)).json()).toMatchObject({ state: "failed", paymentCode: null });
      expect(await prisma.creditLedgerEntry.count()).toBe(0);
    });
  });

  describe("review round 1: storing the created charge fails", () => {
    it("the charge is cancelled, the order fails (not left pending, not counted toward the caps), and the original error fails the request even when cancel throws", async () => {
      const user = await createUser(prisma);
      await seedPaymentSettings(prisma, { paymentsMaxPerAccountPerDayRupiah: STARTER_PRICE_RUPIAH * 2 - 1 });
      jest.spyOn(PaymentOrderRepository.prototype, "attachCharge").mockRejectedValueOnce(new Error("planted store failure"));
      const cancel = jest.spyOn(fake, "cancel").mockRejectedValueOnce(new TypeError("planted cancel failure"));
      const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

      const res = await buyStarter(user.id);

      expect(res.statusCode).toBe(500);
      const order = await prisma.paymentOrder.findFirstOrThrow();
      expect(cancel).toHaveBeenCalledWith(`fake_${order.id}`);
      expect(order).toMatchObject({ status: "failed", providerRef: null });
      expect((await prisma.paymentOrderChange.findMany({ orderBy: { createdAt: "asc" } })).map((c) => c.event)).toEqual(["created", "charge_failed"]);
      const logged = error.mock.calls.flat().map((arg) => (arg instanceof Error ? arg.message : String(arg))).join("\n");
      expect(logged).toContain("planted store failure");
      expect(logged).not.toContain("planted cancel failure");
      expect((await buyStarter(user.id)).statusCode).toBe(201);
    });
  });
});
