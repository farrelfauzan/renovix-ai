import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { Decimal } from "@prisma/client/runtime/client";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import { MAX_RATE_AGE_DAYS } from "../../exchange-rates/config/max-rate-age-days";
import { convertUsdCentsToRupiah } from "../../exchange-rates/utils/convert-usd-cents-to-rupiah";
import { OfferSeedDto } from "../dto/offer-seed.dto";
import { PackageRepository } from "../repository/package.repository";
import { TopUpPackRepository } from "../repository/top-up-pack.repository";
import { OfferCatalogService } from "../service/offer-catalog.service";
import { OfferSeedService } from "../service/offer-seed.service";
import { PlatformSettingsService } from "../service/platform-settings.service";
import { PriceListService } from "../service/price-list.service";
import { PricesController } from "./prices.controller";

// RNX-53 (D237): GET /prices, the public read-only price list in rupiah, on the test database through HTTP. The
// shipped seed (prisma/offers.seed.json) gives the three D237 top-up packs. TEST_RATE is a throwaway rate; global fetch
// is stubbed to refuse, so no test calls the real Frankfurter API.

const SHIPPED_SEED_FILE = resolve(__dirname, "../../../../../../prisma/offers.seed.json");
const TEST_RATE = "16500";
const utcDaysAgo = (days: number): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
};

describe("GET /prices (RNX-53, test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({
      controllers: [PricesController],
      providers: [PriceListService, ExchangeRateService, OfferSeedService, OfferCatalogService, PlatformSettingsService],
    }));
    app = await createFastifyApp(moduleRef);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-53 test: no network"));
    await moduleRef.get(OfferSeedService).applySeed(OfferSeedDto.parse(JSON.parse(readFileSync(SHIPPED_SEED_FILE, "utf8"))), "test");
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => app?.close());

  const storeRate = (rateDate: Date) =>
    prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate: TEST_RATE, rateDate, fetchedAt: new Date(), source: "frankfurter" } });

  it("answers without any credentials with the three top-up packs in rupiah at the stored rate, and the rate, its date and source", async () => {
    await storeRate(utcDaysAgo(1));
    const expectedRupiah = [500, 2000, 3600].map((usdCents) => convertUsdCentsToRupiah({ usdCents, rate: new Decimal(TEST_RATE) }));
    const actual = await app.inject({ method: "GET", url: "/prices" });
    expect(actual.statusCode).toBe(200);
    expect(actual.json()).toEqual({
      rate: TEST_RATE,
      rateDate: utcDaysAgo(1).toISOString().slice(0, 10),
      source: "frankfurter",
      topUpPacks: [
        { name: "Top-up 20 credits", credits: 20, priceRupiah: expectedRupiah[0] },
        { name: "Top-up 100 credits", credits: 100, priceRupiah: expectedRupiah[1] },
        { name: "Top-up 200 credits", credits: 200, priceRupiah: expectedRupiah[2] },
      ],
      packages: [],
    });
    expect(expectedRupiah).toEqual([83000, 330000, 594000]);
  });

  it("returns no US dollar amount", async () => {
    await storeRate(utcDaysAgo(1));
    const actual = await app.inject({ method: "GET", url: "/prices" });
    expect(actual.body).not.toMatch(/usd|cents|\$/i);
  });

  it("reads each offer table once whatever the number of offers (no N+1)", async () => {
    await storeRate(utcDaysAgo(1));
    const mockPacks = jest.spyOn(moduleRef.get(TopUpPackRepository), "findActiveWithCurrentVersion");
    const mockPackages = jest.spyOn(moduleRef.get(PackageRepository), "findListedWithCurrentVersion");
    const mockVersionReads = jest.spyOn(moduleRef.get(TopUpPackRepository), "findLatestVersion");
    await app.inject({ method: "GET", url: "/prices" });
    expect([mockPacks.mock.calls.length, mockPackages.mock.calls.length, mockVersionReads.mock.calls.length]).toEqual([1, 1, 0]);
  });

  it("answers 503 like a purchase when the latest rate is older than MAX_RATE_AGE_DAYS", async () => {
    await storeRate(utcDaysAgo(MAX_RATE_AGE_DAYS + 1));
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const actual = await app.inject({ method: "GET", url: "/prices" });
    expect(actual.statusCode).toBe(503);
    expect(actual.json()).toMatchObject({ message: "Prices are unavailable: no current USD to IDR exchange rate" });
  });
});
