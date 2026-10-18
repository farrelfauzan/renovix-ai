import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * One tier's per-token credit rates (RX-21). The credit CHARGING path multiplies token counts by
 * these rates; the DISPLAY path shows dollar prices (inputPrice x markupMultiplier).
 */
export interface TierRates {
  /** The tier's rate for the kind: CREDITS PER 1,000,000 TOKENS of that kind (docs/credits.md section 1);
   *  the cost helpers divide the token-weighted sum by 1,000,000 (section 1.3). Column names keep the
   *  short form; the values are the adopted per-1,000,000 figures seeded from prisma/tier-rates.seed.json. */
  inputCreditsPerToken: Decimal;
  cachedCreditsPerToken: Decimal;
  outputCreditsPerToken: Decimal;
}

export interface ModelConfig {
  slug: string;
  modelName: string;
  provider: string;
  providerId: string;
  inputPrice: Decimal;
  outputPrice: Decimal;
  cachedInputPrice: Decimal | null;
  maxTokens: number;
  maxOutputTokens: number | null;
  tier: string;
  creditMultiplier: Decimal;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

@Injectable()
export class ModelRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModelRegistryService.name);
  private models = new Map<string, ModelConfig>();
  private tierRates = new Map<string, TierRates>();
  private markupMultiplier = new Decimal(2);
  private lastRefresh = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const aiModels = await this.prisma.aiModel.findMany({
      where: { active: true },
    });
    const rateRows = await this.prisma.tierRate.findMany();
    const markupConfig = await this.prisma.appConfig.findUnique({
      where: { key: "markup_multiplier" },
    });

    const map = new Map<string, ModelConfig>();
    for (const m of aiModels) {
      map.set(m.slug, {
        slug: m.slug,
        modelName: m.modelName,
        provider: m.provider,
        providerId: m.providerId,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        cachedInputPrice: m.cachedInputPrice,
        maxTokens: m.maxTokens,
        maxOutputTokens: m.maxOutputTokens,
        tier: m.tier,
        // RX-21: kept for DISPLAY pricing only; charging uses the tier rates.
        creditMultiplier: m.creditMultiplier,
      });
    }
    this.models = map;

    const rates = new Map<string, TierRates>();
    for (const row of rateRows) {
      rates.set(row.tier, {
        inputCreditsPerToken: row.inputCreditsPerToken,
        cachedCreditsPerToken: row.cachedCreditsPerToken,
        outputCreditsPerToken: row.outputCreditsPerToken,
      });
    }
    this.tierRates = rates;

    if (markupConfig) {
      this.markupMultiplier = new Decimal(markupConfig.value);
    }

    this.lastRefresh = Date.now();
    this.logger.log(
      `Loaded ${map.size} models, ${rates.size} tier rates, markup=${this.markupMultiplier}`,
    );
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastRefresh > CACHE_TTL_MS) {
      await this.refresh();
    }
  }

  async getModel(slug: string): Promise<ModelConfig | undefined> {
    await this.ensureFresh();
    return this.models.get(slug);
  }

  async getModelByProviderId(
    providerId: string,
  ): Promise<ModelConfig | undefined> {
    await this.ensureFresh();
    for (const model of this.models.values()) {
      if (model.providerId === providerId) return model;
    }
    return undefined;
  }

  async resolveModel(identifier: string): Promise<ModelConfig | undefined> {
    const bySlug = await this.getModel(identifier);
    if (bySlug) return bySlug;
    return this.getModelByProviderId(identifier);
  }

  async getAllModels(): Promise<ModelConfig[]> {
    await this.ensureFresh();
    return [...this.models.values()];
  }

  /** The per-token credit rates of `tier` (RX-21). Undefined when the tier has no rate row. */
  async getTierRates(tier: string): Promise<TierRates | undefined> {
    await this.ensureFresh();
    return this.tierRates.get(tier);
  }

  async getMarkup(): Promise<Decimal> {
    await this.ensureFresh();
    return this.markupMultiplier;
  }

  /**
   * DISPLAY pricing (dollar prices for the portals): the provider prices doubled by the markup
   * multiplier. Charging does NOT use these: it charges the tier's per-token credit rates
   * (getTierRates, RX-21).
   */
  async getUserPrice(
    slug: string,
  ): Promise<
    | { inputPrice: Decimal; outputPrice: Decimal; creditMultiplier: Decimal }
    | undefined
  > {
    await this.ensureFresh();
    const model = this.models.get(slug);
    if (!model) return undefined;
    return {
      inputPrice: model.inputPrice.mul(this.markupMultiplier),
      outputPrice: model.outputPrice.mul(this.markupMultiplier),
      creditMultiplier: model.creditMultiplier,
    };
  }

  /** Cheapest active model, optionally only among models of `tier`. */
  async getCheapestModel(tier?: string): Promise<ModelConfig | undefined> {
    await this.ensureFresh();
    const models = [...this.models.values()].filter(
      (m) => !tier || m.tier === tier,
    );
    if (models.length === 0) return undefined;
    return models.sort(
      (a, b) =>
        a.inputPrice.add(a.outputPrice).toNumber() -
        b.inputPrice.add(b.outputPrice).toNumber(),
    )[0];
  }
}
