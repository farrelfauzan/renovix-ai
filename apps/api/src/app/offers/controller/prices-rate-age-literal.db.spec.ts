import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createFastifyApp, createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import { OfferSeedDto } from "../dto/offer-seed.dto";
import { OfferCatalogService } from "../service/offer-catalog.service";
import { OfferSeedService } from "../service/offer-seed.service";
import { PlatformSettingsService } from "../service/platform-settings.service";
import { PriceListService } from "../service/price-list.service";
import { PricesController } from "./prices.controller";

// RNX-236: pins the decided 7-day exchange-rate limit (D237) through GET /prices with literal ages. It deliberately
// does not import MAX_RATE_AGE_DAYS, so changing the constant turns these red. The clock is fixed (Date only) at
// 2026-10-21 12:00 UTC: 7 days ago is 2026-10-14, 8 days ago is 2026-10-13. Rates are throwaway test values.

const SHIPPED_SEED_FILE = resolve(__dirname, "../../../../../../prisma/offers.seed.json");
const FIXED_NOW = new Date("2026-10-21T12:00:00.000Z");

describe("GET /prices rate age with literal days (RNX-236, test database)", () => {
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
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("RNX-236 test: no network"));
    await moduleRef.get(OfferSeedService).applySeed(OfferSeedDto.parse(JSON.parse(readFileSync(SHIPPED_SEED_FILE, "utf8"))), "test");
    // Fakes only Date (Prisma and pg keep their real timers).
    jest.useFakeTimers({
      now: FIXED_NOW,
      doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => app?.close());

  const storeRate = (rateDate: Date) =>
    prisma.exchangeRate.create({ data: { base: "USD", quote: "IDR", rate: "16500", rateDate, fetchedAt: FIXED_NOW, source: "frankfurter" } });

  it("a stored rate dated 7 UTC calendar days ago is used when a price is quoted", async () => {
    await storeRate(new Date("2026-10-14T00:00:00.000Z"));
    const actual = await app.inject({ method: "GET", url: "/prices" });
    expect(actual.statusCode).toBe(200);
    expect(actual.json()).toMatchObject({ rate: "16500", rateDate: "2026-10-14" });
  });

  it("a stored rate dated 8 UTC calendar days ago makes the API answer 503 when a price is quoted", async () => {
    await storeRate(new Date("2026-10-13T00:00:00.000Z"));
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const actual = await app.inject({ method: "GET", url: "/prices" });
    expect(actual.statusCode).toBe(503);
    expect(actual.json()).toMatchObject({ message: "Prices are unavailable: no current USD to IDR exchange rate" });
  });
});
