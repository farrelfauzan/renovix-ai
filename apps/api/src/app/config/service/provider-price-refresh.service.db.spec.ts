import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { ProviderPriceRefreshService } from "./provider-price-refresh.service";

// RX-21 AC2 (test database — needs TEST_DATABASE_URL): the provider reports a risen price; the job's
// check method (called directly, no cron wait) updates the row, logs the alert (Logger.error) and
// writes a catalog_changes row naming the model with its old and new price. No email (D50).

describe("RX-21 AC2: the price refresh alerts on a provider price rise (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refresh: ProviderPriceRefreshService;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [ProviderPriceRefreshService] }));
    refresh = moduleRef.get(ProviderPriceRefreshService);
  });

  beforeEach(() => resetDatabase(prisma));
  afterAll(() => moduleRef?.close());

  const createModel = async (inputPrice: string) =>
    prisma.aiModel.create({
      data: {
        slug: "rise-model",
        modelName: "Rise Model",
        provider: "openrouter",
        providerId: "vendor/rise-model",
        inputPrice,
        outputPrice: "0.0000002",
        maxTokens: 8192,
        tier: "standard",
      },
    });

  it("updates the price, stamps price_updated_at, logs the alert and writes a catalog_changes row", async () => {
    const model = await createModel("0.0000001");
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    // The fake provider's list-models: the input price rose from 0.0000001 to 0.0000003 per token (200%, above the
    // 0.2 default alert ratio).
    refresh.setListModeler(async () => [
      { providerId: "vendor/rise-model", inputPrice: "0.0000003", outputPrice: "0.0000002", cachedInputPrice: null },
    ]);

    try {
      const result = await refresh.checkProviderPrices("openrouter");

      expect(result).toEqual({ checked: 1, updated: 1, alerted: 1 });
      const updated = await prisma.aiModel.findUniqueOrThrow({ where: { id: model.id } });
      expect(updated.inputPrice.toFixed()).toBe("0.0000003");
      expect(updated.priceUpdatedAt).not.toBeNull();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("vendor/rise-model"),
      );
      const change = await prisma.catalogChange.findFirstOrThrow({ where: { entity: "ai_model", entityId: model.id } });
      expect(change.changedBy).toBe("price-refresh:openrouter");
      expect(change.reason).toContain("vendor/rise-model");
      expect((change.before as Record<string, unknown>).inputPrice).toBe(0.0000001);
      expect((change.after as Record<string, unknown>).inputPrice).toBeCloseTo(0.0000003, 12);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("alerts on a price move alone, when the price stays under the tier's planning cost", async () => {
    // 0.00000005 -> 0.0000001 per token is a 100% move (above the 0.2 default ratio). At 0.0000001
    // input (no cached price, so cached at the input price) and 0.0000002 output, the standard tier's
    // cost per credit at the token mix is (0.36 x 0.1 + 0.54 x 0.1 + 0.10 x 0.2) / 1 = 0.11, under
    // its 0.14 planning cost (RNX-185), so only the price-moved alert can fire here.
    const model = await createModel("0.00000005");
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    refresh.setListModeler(async () => [
      { providerId: "vendor/rise-model", inputPrice: "0.0000001", outputPrice: "0.0000002", cachedInputPrice: null },
    ]);

    try {
      const result = await refresh.checkProviderPrices("openrouter");

      expect(result).toEqual({ checked: 1, updated: 1, alerted: 1 });
      const changes = await prisma.catalogChange.findMany({ where: { entity: "ai_model", entityId: model.id } });
      expect(changes).toHaveLength(1);
      expect(changes[0].reason).toContain("price moved more than");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("writes nothing when the provider's prices are unchanged", async () => {
    await createModel("0.0000001");
    refresh.setListModeler(async () => [
      { providerId: "vendor/rise-model", inputPrice: "0.0000001", outputPrice: "0.0000002", cachedInputPrice: null },
    ]);

    const result = await refresh.checkProviderPrices("openrouter");

    expect(result).toEqual({ checked: 1, updated: 0, alerted: 0 });
    expect(await prisma.catalogChange.count()).toBe(0);
    expect((await prisma.aiModel.findFirstOrThrow()).priceUpdatedAt).toBeNull();
  });

  it("fills a cached price the provider newly reports, without an alert", async () => {
    const model = await createModel("0.0000001");
    refresh.setListModeler(async () => [
      { providerId: "vendor/rise-model", inputPrice: "0.0000001", outputPrice: "0.0000002", cachedInputPrice: "0.00000005" },
    ]);

    const result = await refresh.checkProviderPrices("openrouter");

    expect(result).toEqual({ checked: 1, updated: 1, alerted: 0 });
    expect(
      (await prisma.aiModel.findUniqueOrThrow({ where: { id: model.id } })).cachedInputPrice?.toFixed(),
    ).toBe("0.00000005");
  });
});
