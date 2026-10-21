import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { TransactionService } from "../../prisma/transaction.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { createUser } from "../../../../test/factories";
import { OfferCatalogService } from "../../offers/service/offer-catalog.service";
import { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import { MAX_RATE_AGE_DAYS } from "../config/max-rate-age-days";
import { RATE_REFRESH_RETRY_AFTER_MINUTES } from "../config/rate-refresh-retry-after-minutes";
import { ExchangeRateRepository } from "../repository/exchange-rate.repository";
import { ExchangeRateService } from "./exchange-rate.service";

// RNX-53 (D235, D237): the USD to IDR rate, refreshed lazily on quote and purchase, and the rate stored on each
// purchase, on the test database. The source is stubbed by spying on global fetch; by default the stub refuses, so
// no test calls the real Frankfurter API. Rates and prices are throwaway
// test values, not decided prices or a real rate.

const AUTHOR = { changedBy: "admin-test", reason: "test change" };
const EXAMPLE_PRO_TERMS = {
  priceUsdCents: 1900,
  creditsGranted: 20,
  billing: "one_time" as const,
  maxAgents: 10,
  maxConnectedTools: 5,
  apiAccess: true,
  allowedChannels: ["web"],
  allowedTiers: ["standard" as const],
};
const PRICES_UNAVAILABLE = "Prices are unavailable: no current USD to IDR exchange rate";

/** The UTC calendar date `days` days before today, at UTC midnight (the shape of a DATE column). */
const utcDaysAgo = (days: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
};
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
const frankfurterAnswer = (rate: unknown, date: string): Response =>
  new Response(JSON.stringify({ date, base: "USD", quote: "IDR", rate }), { status: 200, headers: { "content-type": "application/json" } });
const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);
/** Fakes only Date (Prisma and pg keep their real timers), so a test can move the clock deterministically. */
const fakeDateOnly = (): void => {
  jest.useFakeTimers({
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
};
const timeoutError = (): Error => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("ExchangeRateService and purchases (RNX-53, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let rates: ExchangeRateService;
  let purchases: PurchaseSnapshotService;
  let catalog: OfferCatalogService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [ExchangeRateService, PurchaseSnapshotService, OfferCatalogService] }));
    rates = moduleRef.get(ExchangeRateService);
    purchases = moduleRef.get(PurchaseSnapshotService);
    catalog = moduleRef.get(OfferCatalogService);
  });

  let mockFetch: jest.SpyInstance;

  beforeEach(async () => {
    await resetDatabase(prisma);
    mockFetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-53 test: no network"));
    // The service is one instance for the whole file: forget a failed refresh of an earlier test (retry gap).
    Object.assign(rates, { lastFailedRefreshAt: null });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => moduleRef?.close());

  const stubSource = (answer: () => Promise<Response>) => mockFetch.mockImplementation(answer as typeof fetch);
  const storeRate = (rate: string, rateDate: Date, fetchedAt = new Date()) =>
    prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate, rateDate, fetchedAt, source: "frankfurter" } });
  /** Holds every caller right after its first latest-rate read until `callers` have read, so all of them see the same stale rate. */
  const holdCallersAfterLatestRead = (callers: number) => {
    const repository = moduleRef.get(ExchangeRateRepository);
    const findLatest = repository.findLatest.bind(repository);
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));
    const heldFindLatest = async (...args: Parameters<typeof findLatest>) => {
      const result = await findLatest(...args);
      arrived += 1;
      if (arrived === callers) releaseAll();
      await allArrived;
      return result;
    };
    jest.spyOn(repository, "findLatest").mockImplementation(heldFindLatest as typeof findLatest);
  };
  const createProVersion = async () => {
    const pro = await catalog.savePackage({ name: "Pro", displayOrder: 2, active: true, visible: true }, AUTHOR);
    return catalog.savePackageVersion({ ownerId: pro.id, terms: EXAMPLE_PRO_TERMS, author: AUTHOR });
  };
  const buyPro = async (versionId: string) => {
    const buyer = await createUser(prisma);
    return purchases.recordPackagePurchase({ buyerUserId: buyer.id, versionId, paymentId: null });
  };

  describe("AC Refresh", () => {
    it("stores the source's rate with its own date, the fetch time and the source, and a following purchase uses it", async () => {
      const inputDate = isoDate(utcDaysAgo(1));
      stubSource(() => Promise.resolve(frankfurterAnswer(16500, inputDate)));
      const version = await createProVersion();
      const actualResult = await rates.refreshRate();
      const actualRows = await prisma.exchangeRate.findMany();
      const actualSnapshot = await buyPro(version.id);
      expect(actualResult).toEqual({ isStored: true, rateDate: inputDate });
      expect(actualRows).toHaveLength(1);
      expect(actualRows[0]).toMatchObject({ base: "USD", quote: "IDR", rateDate: new Date(inputDate), source: "frankfurter", fetchedAt: expect.any(Date) });
      expect(actualRows[0].rate.toString()).toBe("16500");
      expect(actualSnapshot.exchangeRate.toString()).toBe("16500");
      expect(actualSnapshot.priceRupiah).toBe(314000);
    });

    it("refreshing again for the same rate date stores one row, also when instances refresh at the same moment", async () => {
      stubSource(() => Promise.resolve(frankfurterAnswer(16500, isoDate(utcDaysAgo(0)))));
      await rates.refreshRate();
      const actualResults = await Promise.all([rates.refreshRate(), rates.refreshRate(), rates.refreshRate()]);
      expect(actualResults.map((result) => result.isStored)).toEqual([true, true, true]);
      expect(await prisma.exchangeRate.count()).toBe(1);
    });
  });

  describe("AC Refresh is lazy (D237)", () => {
    it("a rate fetched 25 hours ago is refreshed once before the purchase, which uses the new rate", async () => {
      await storeRate("16500", utcDaysAgo(1), hoursAgo(25));
      stubSource(() => Promise.resolve(frankfurterAnswer(17000, isoDate(utcDaysAgo(0)))));
      const version = await createProVersion();
      const actual = await buyPro(version.id);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(actual.exchangeRate.toString()).toBe("17000");
    });

    it("five concurrent purchases that all read a stale rate trigger exactly one fetch (single-flight)", async () => {
      await storeRate("16500", utcDaysAgo(1), hoursAgo(25));
      stubSource(() => Promise.resolve(frankfurterAnswer(17000, isoDate(utcDaysAgo(0)))));
      const version = await createProVersion();
      holdCallersAfterLatestRead(5);
      const actual = await Promise.all([1, 2, 3, 4, 5].map(() => buyPro(version.id)));
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(actual.map((snapshot) => snapshot.exchangeRate.toString())).toEqual(["17000", "17000", "17000", "17000", "17000"]);
    });

    it("a rate fetched 1 hour ago is used without a fetch", async () => {
      await storeRate("16500", utcDaysAgo(1), hoursAgo(1));
      const version = await createProVersion();
      const actual = await buyPro(version.id);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(actual.exchangeRate.toString()).toBe("16500");
    });

    it("with no rate at all, one fetch; when it succeeds the purchase goes through at the fetched rate", async () => {
      stubSource(() => Promise.resolve(frankfurterAnswer(16500, isoDate(utcDaysAgo(0)))));
      const version = await createProVersion();
      const actual = await buyPro(version.id);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect({ rate: actual.exchangeRate.toString(), priceRupiah: actual.priceRupiah }).toEqual({ rate: "16500", priceRupiah: 314000 });
    });

    it("with no rate at all, one fetch; when it fails the purchase is refused with 503", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const version = await createProVersion();
      const actual = await buyPro(version.id).catch((err: unknown) => err);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(actual).toBeInstanceOf(ServiceUnavailableException);
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
    });

    it("a failed refresh with a usable older rate (3 days old, fetched 25 hours ago) still serves the price, with a warning", async () => {
      await storeRate("16400", utcDaysAgo(3), hoursAgo(25));
      const mockWarn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      stubSource(() => Promise.resolve(new Response("{}", { status: 500 })));
      const version = await createProVersion();
      const actual = await buyPro(version.id);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("USD to IDR rate refresh from frankfurter failed: HTTP 500"));
      expect({ rate: actual.exchangeRate.toString(), rateDate: actual.exchangeRateDate }).toEqual({ rate: "16400", rateDate: utcDaysAgo(3) });
    });

    it("source down with a usable rate fetched 25 hours ago: 1 fetch, none 1 minute later, 1 again after 6 minutes (retry gap)", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      fakeDateOnly();
      const start = Date.now();
      await storeRate("16400", utcDaysAgo(3), new Date(start - 25 * 3_600_000));
      stubSource(() => Promise.resolve(new Response("{}", { status: 500 })));
      const actualFirst = await rates.getPurchaseRate();
      const fetchesAfterFirst = mockFetch.mock.calls.length;
      jest.setSystemTime(start + 60_000);
      const actualSecond = await rates.getPurchaseRate();
      const fetchesAfterSecond = mockFetch.mock.calls.length;
      jest.setSystemTime(start + (RATE_REFRESH_RETRY_AFTER_MINUTES + 1) * 60_000);
      const actualThird = await rates.getPurchaseRate();
      expect([fetchesAfterFirst, fetchesAfterSecond, mockFetch.mock.calls.length]).toEqual([1, 1, 2]);
      expect([actualFirst, actualSecond, actualThird].map((rate) => rate.rate.toString())).toEqual(["16400", "16400", "16400"]);
    });

    it("no rate and the source down: the first call fetches once and gets 503; a second call within the retry gap fetches nothing and gets 503, one notification", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      fakeDateOnly();
      const start = Date.now();
      const actualFirst = await rates.getPurchaseRate().catch((err: unknown) => err);
      const fetchesAfterFirst = mockFetch.mock.calls.length;
      jest.setSystemTime(start + 60_000);
      const actualSecond = await rates.getPurchaseRate().catch((err: unknown) => err);
      expect([fetchesAfterFirst, mockFetch.mock.calls.length]).toEqual([1, 1]);
      expect(actualFirst).toBeInstanceOf(ServiceUnavailableException);
      expect(actualSecond).toBeInstanceOf(ServiceUnavailableException);
      expect(await prisma.adminNotification.count()).toBe(1);
    });

    it("a refresh that finds no newer rate date (weekend) moves fetchedAt forward, so the next purchase does not fetch again", async () => {
      await storeRate("16500", utcDaysAgo(2), hoursAgo(25));
      stubSource(() => Promise.resolve(frankfurterAnswer(16500, isoDate(utcDaysAgo(2)))));
      const version = await createProVersion();
      await buyPro(version.id);
      await buyPro(version.id);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(await prisma.exchangeRate.count()).toBe(1);
      expect((await prisma.exchangeRate.findFirstOrThrow()).fetchedAt.getTime()).toBeGreaterThan(hoursAgo(1).getTime());
    });
  });

  describe("AC Source down", () => {
    it.each([
      ["a timeout", () => Promise.reject(timeoutError())],
      ["HTTP 500", () => Promise.resolve(new Response("{}", { status: 500 }))],
      ["a rate of 0", () => Promise.resolve(frankfurterAnswer(0, isoDate(utcDaysAgo(0))))],
      ["a rate of -1", () => Promise.resolve(frankfurterAnswer(-1, isoDate(utcDaysAgo(0))))],
      ["a rate of \"abc\"", () => Promise.resolve(frankfurterAnswer("abc", isoDate(utcDaysAgo(0))))],
    ])("on %s it stores nothing, logs a warning and the previous rate stays in use", async (_case, mockAnswer) => {
      await storeRate("16400", utcDaysAgo(1));
      const mockWarn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      stubSource(mockAnswer);
      const actualResult = await rates.refreshRate();
      const actualRate = await rates.getPurchaseRate();
      expect(actualResult).toEqual({ isStored: false, reason: expect.any(String) });
      expect(await prisma.exchangeRate.count()).toBe(1);
      expect(actualRate.rate.toString()).toBe("16400");
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("USD to IDR rate refresh from frankfurter failed"));
    });

    it.each([
      ["the latest rate is MAX_RATE_AGE_DAYS + 1 days old", MAX_RATE_AGE_DAYS + 1],
      ["there is no rate at all", null],
    ])("when %s, a purchase is refused with 503, nothing is bought and the owners get one unread notification, not one per refusal", async (_case, inputAgeDays) => {
      if (inputAgeDays !== null) await storeRate("16500", utcDaysAgo(inputAgeDays));
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const version = await createProVersion();
      const actualFirst = await buyPro(version.id).catch((err: unknown) => err);
      const actualSecond = await buyPro(version.id).catch((err: unknown) => err);
      const actualNotifications = await prisma.adminNotification.findMany();
      expect(actualFirst).toBeInstanceOf(ServiceUnavailableException);
      expect((actualFirst as ServiceUnavailableException).getStatus()).toBe(503);
      expect((actualFirst as ServiceUnavailableException).message).toBe(PRICES_UNAVAILABLE);
      expect(actualSecond).toBeInstanceOf(ServiceUnavailableException);
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
      expect(actualNotifications).toEqual([
        expect.objectContaining({ recipientRole: "owner", kind: "exchange_rate_unavailable", subjectAdminId: null, readAt: null }),
      ]);
    });

    it("a refused top-up purchase is refused the same way", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const pack = await catalog.saveTopUpPack({ name: "Example pack", active: true }, AUTHOR);
      const version = await catalog.saveTopUpPackVersion({ ownerId: pack.id, terms: { creditsGranted: 10, priceUsdCents: 500 }, author: AUTHOR });
      const buyer = await createUser(prisma);
      await expect(purchases.recordTopUpPurchase({ buyerUserId: buyer.id, versionId: version.id, paymentId: null })).rejects.toThrow(ServiceUnavailableException);
      expect(await prisma.purchaseSnapshot.count()).toBe(0);
      expect(await prisma.adminNotification.count()).toBe(1);
    });

    it("the notification survives a refusal inside the caller's transaction", async () => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const version = await createProVersion();
      const buyer = await createUser(prisma);
      const transactions = moduleRef.get(TransactionService);
      const actual = transactions.run((tx) => purchases.recordPackagePurchase({ buyerUserId: buyer.id, versionId: version.id, paymentId: null }, tx));
      await expect(actual).rejects.toThrow(ServiceUnavailableException);
      expect(await prisma.adminNotification.count()).toBe(1);
    });

    it("a rate exactly MAX_RATE_AGE_DAYS old is still used", async () => {
      await storeRate("16500", utcDaysAgo(MAX_RATE_AGE_DAYS));
      const version = await createProVersion();
      const actual = await buyPro(version.id);
      expect(actual.exchangeRateDate).toEqual(utcDaysAgo(MAX_RATE_AGE_DAYS));
      expect(await prisma.adminNotification.count()).toBe(0);
    });
  });

  describe("AC Stored per charge", () => {
    it("a purchase keeps the rate it was charged at; a newer rate changes only later purchases", async () => {
      await storeRate("16500", utcDaysAgo(1));
      const version = await createProVersion();
      const firstSnapshot = await buyPro(version.id);
      stubSource(() => Promise.resolve(frankfurterAnswer(17000, isoDate(utcDaysAgo(0)))));
      await rates.refreshRate();
      const secondSnapshot = await buyPro(version.id);
      const actualFirst = await prisma.purchaseSnapshot.findUniqueOrThrow({ where: { id: firstSnapshot.id } });
      expect(actualFirst).toEqual(firstSnapshot);
      expect({ ...actualFirst, exchangeRate: actualFirst.exchangeRate.toString() }).toMatchObject({
        priceUsdCents: 1900,
        exchangeRate: "16500",
        exchangeRateDate: utcDaysAgo(1),
        exchangeRateSource: "frankfurter",
        priceRupiah: 314000,
      });
      expect({ ...secondSnapshot, exchangeRate: secondSnapshot.exchangeRate.toString() }).toMatchObject({
        priceUsdCents: 1900,
        exchangeRate: "17000",
        exchangeRateDate: utcDaysAgo(0),
        exchangeRateSource: "frankfurter",
        priceRupiah: 323000,
      });
    });
  });
});
