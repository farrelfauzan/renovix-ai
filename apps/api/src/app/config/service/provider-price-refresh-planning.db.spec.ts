import { Logger } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { createTestModule } from "../../../../test/test-module";
import { resetDatabase } from "../../../../test/test-database";
import { ProviderPriceRefreshService } from "./provider-price-refresh.service";

// RNX-185 (test database — needs TEST_DATABASE_URL): the price refresh's planning-cost alert uses the model's cost
// per credit at the token mix (0.36 new input / 0.54 cached input / 0.10 output, over the tier rates blended at the
// same mix) and one explicit planning cost per tier ($0.14 each, D237). Fixture prices are given in dollars per
// 1,000,000 tokens in the comments and stored per token; the provider is a fake list-models (no key, no network).

describe("RNX-185: the planning-cost alert uses the token-mix cost per credit and one threshold per tier (test database)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let refresh: ProviderPriceRefreshService;
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    ({ moduleRef, prisma } = await createTestModule({ providers: [ProviderPriceRefreshService] }));
    refresh = moduleRef.get(ProviderPriceRefreshService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());
  afterAll(() => moduleRef?.close());

  const createTierRate = (tier: string, newInput: string, cachedInput: string, output: string) =>
    prisma.tierRate.create({
      data: { tier, inputCreditsPerToken: newInput, cachedCreditsPerToken: cachedInput, outputCreditsPerToken: output },
    });

  const setPlanningCostOverride = (tier: string, value: string) =>
    prisma.appConfig.create({ data: { key: `tier_planning_cost_per_credit_${tier}`, value } });

  /** Creates the models (prices in dollars per token) and lets the fake provider list them at the same prices, so no price moves; then runs the job. */
  const runWithModels = async (
    models: { providerId: string; tier: string; inputPrice: string; cachedInputPrice: string | null; outputPrice: string }[],
  ) => {
    const rows = [];
    for (const model of models) {
      rows.push(
        await prisma.aiModel.create({
          data: {
            slug: model.providerId,
            modelName: `Model ${model.providerId}`,
            provider: "openrouter",
            providerId: model.providerId,
            inputPrice: model.inputPrice,
            cachedInputPrice: model.cachedInputPrice,
            outputPrice: model.outputPrice,
            maxTokens: 8192,
            tier: model.tier,
          },
        }),
      );
    }
    refresh.setListModeler(async () =>
      models.map(({ providerId, inputPrice, cachedInputPrice, outputPrice }) => ({ providerId, inputPrice, cachedInputPrice, outputPrice })),
    );
    const result = await refresh.checkProviderPrices("openrouter");
    const changes = await prisma.catalogChange.findMany({ where: { entity: "ai_model" } });
    const errors = errorSpy.mock.calls.map((call) => String(call[0]));
    return { rows, result, changes, errors };
  };

  it("AC1: a Standard model at plan (0.15 / 0.03 / 0.50 per million, rates 1/1/1) costs $0.1202 per credit, under 0.14: no planning alert", async () => {
    await createTierRate("standard", "1", "1", "1");

    const actual = await runWithModels([
      { providerId: "vendor/glm-flash", tier: "standard", inputPrice: "0.00000015", cachedInputPrice: "0.00000003", outputPrice: "0.0000005" },
    ]);

    expect(actual.result).toEqual({ checked: 1, updated: 0, alerted: 0 });
    expect(actual.changes).toHaveLength(0);
    expect(actual.errors).toEqual([]);
  });

  it("AC2: a Standard model above plan (0.30 / 0.03 / 1.20 per million, $0.2442 per credit) gets exactly one planning alert, logged and recorded", async () => {
    await createTierRate("standard", "1", "1", "1");

    const actual = await runWithModels([
      { providerId: "vendor/deepseek-peak", tier: "standard", inputPrice: "0.0000003", cachedInputPrice: "0.00000003", outputPrice: "0.0000012" },
    ]);

    expect(actual.result).toEqual({ checked: 1, updated: 0, alerted: 1 });
    expect(actual.changes).toHaveLength(1);
    const expectedReason =
      "Model vendor/deepseek-peak (Model vendor/deepseek-peak), tier standard: costs 0.244200 dollars per credit, above the tier's planning cost 0.14 (price basis: openrouter list price at the token mix 0.36 new input / 0.54 cached input / 0.10 output, over the tier rates blended at the same mix)";
    expect(actual.changes[0]).toMatchObject({ entityId: actual.rows[0].id, changedBy: "price-refresh:openrouter", reason: expectedReason });
    expect(actual.errors).toEqual([`RX-21 price alert: ${expectedReason}`]);
  });

  // Frontier-shaped fixture: 4 / 0.20 / 20 per million at 29/29/42. Mix: 3.548 / 30.3 = $0.117096 per credit.
  // Input only (the old formula): 4 / 29 = $0.137931 per credit. A planning cost of 0.13 lies strictly between.
  it("AC3: output counts — a Frontier model at $0.117096 per credit (mix) is under a 0.13 planning cost the input-only $0.137931 would exceed", async () => {
    await createTierRate("frontier", "29", "29", "42");
    await setPlanningCostOverride("frontier", "0.13");

    const actual = await runWithModels([
      { providerId: "vendor/opus", tier: "frontier", inputPrice: "0.000004", cachedInputPrice: "0.0000002", outputPrice: "0.00002" },
    ]);

    expect(actual.result).toEqual({ checked: 1, updated: 0, alerted: 0 });
    expect(actual.changes).toHaveLength(0);
    expect(actual.errors).toEqual([]);
  });

  it("AC3: the same Frontier model under a 0.115 planning cost alerts with the mix figure $0.117096", async () => {
    await createTierRate("frontier", "29", "29", "42");
    await setPlanningCostOverride("frontier", "0.115");

    const actual = await runWithModels([
      { providerId: "vendor/opus", tier: "frontier", inputPrice: "0.000004", cachedInputPrice: "0.0000002", outputPrice: "0.00002" },
    ]);

    expect(actual.changes).toHaveLength(1);
    expect(actual.changes[0].reason).toContain("tier frontier: costs 0.117096 dollars per credit, above the tier's planning cost 0.115");
  });

  // 0.20 new input, no cached price, 1.00 output per million at 1/1/1: 0.36 x 0.20 + 0.54 x 0.20 + 0.10 x 1.00 = 0.28.
  // (Cached share at 0 would give 0.172; input only would give 0.20.)
  it("AC4: a model with no cached price has its cached share priced at the new-input price ($0.28 per credit)", async () => {
    await createTierRate("standard", "1", "1", "1");

    const actual = await runWithModels([
      { providerId: "vendor/no-cache", tier: "standard", inputPrice: "0.0000002", cachedInputPrice: null, outputPrice: "0.000001" },
    ]);

    expect(actual.changes).toHaveLength(1);
    expect(actual.changes[0].reason).toContain("tier standard: costs 0.280000 dollars per credit, above the tier's planning cost 0.14");
  });

  it("AC5: a tier with no planning cost logs an error naming it, gets no planning alert, and the other tiers are still checked", async () => {
    await createTierRate("ultra", "1", "1", "1");
    await createTierRate("standard", "1", "1", "1");

    const actual = await runWithModels([
      { providerId: "vendor/ultra-model", tier: "ultra", inputPrice: "0.0000003", cachedInputPrice: "0.00000003", outputPrice: "0.0000012" },
      { providerId: "vendor/deepseek-peak", tier: "standard", inputPrice: "0.0000003", cachedInputPrice: "0.00000003", outputPrice: "0.0000012" },
    ]);

    expect(actual.result).toEqual({ checked: 2, updated: 0, alerted: 1 });
    expect(actual.errors).toContain(
      "RNX-185: tier ultra has no planning cost per credit; planning-cost check skipped for model vendor/ultra-model",
    );
    expect(actual.changes).toHaveLength(1);
    expect(actual.changes[0]).toMatchObject({ entityId: actual.rows[1].id });
    expect(actual.changes[0].reason).toContain("tier standard: costs 0.244200");
  });

  it("a tier whose rates blend to 0 at the mix logs an error naming the tier and model and gets no planning alert (no Infinity or NaN cost)", async () => {
    await createTierRate("standard", "0", "0", "0");

    const actual = await runWithModels([
      { providerId: "vendor/zero-rate", tier: "standard", inputPrice: "0.00000015", cachedInputPrice: "0.00000003", outputPrice: "0.0000005" },
      { providerId: "vendor/free-zero-rate", tier: "standard", inputPrice: "0", cachedInputPrice: "0", outputPrice: "0" },
    ]);

    expect(actual.result).toEqual({ checked: 2, updated: 0, alerted: 0 });
    expect(actual.changes).toHaveLength(0);
    expect(actual.errors).toEqual([
      "RNX-185: tier standard has rates that blend to 0 at the token mix; planning-cost check skipped for model vendor/zero-rate",
      "RNX-185: tier standard has rates that blend to 0 at the token mix; planning-cost check skipped for model vendor/free-zero-rate",
    ]);
  });

  it("a non-positive AppConfig override is logged and ignored: the tier keeps its D237 planning cost (no fallback default)", async () => {
    await createTierRate("standard", "1", "1", "1");
    await setPlanningCostOverride("standard", "0");

    const actual = await runWithModels([
      { providerId: "vendor/glm-flash", tier: "standard", inputPrice: "0.00000015", cachedInputPrice: "0.00000003", outputPrice: "0.0000005" },
    ]);

    expect(actual.result).toEqual({ checked: 1, updated: 0, alerted: 0 });
    expect(actual.errors).toEqual([
      'RNX-185: AppConfig tier_planning_cost_per_credit_standard = "0" is not a positive dollar amount and is ignored; tier standard keeps 0.14',
    ]);
  });
});
