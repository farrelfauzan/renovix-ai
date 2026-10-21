import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderRepository } from "../admin-providers/repository/provider.repository";
import { resolveLlmProvider } from "../providers/llm-provider";
import type { ModelConnection } from "../providers/types/model-connection";
import { ModelUnavailableException } from "./errors/model-unavailable.exception";
import type { CachedConnection } from "./types/cached-connection";
import { isTierAbove } from "./utils/is-tier-above";

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
/** LLM_PROVIDER=fake (RX-88, D199-5): the connection every slug gets; the fake adapter never sends it anywhere. */
const FAKE_CONNECTION = { baseUrl: "http://fake-provider.invalid/v1", apiKey: "", providerName: "fake" } as const;

@Injectable()
export class ModelRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ModelRegistryService.name);
  private models = new Map<string, ModelConfig>();
  /** RX-178: active models whose provider record is active and live, by slug. */
  private connections = new Map<string, CachedConnection>();
  /** RNX-179: each active model's fallback model slugs, in order (active or not; resolveConnection filters). */
  private fallbackSlugs = new Map<string, string[]>();
  private tierRates = new Map<string, TierRates>();
  private markupMultiplier = new Decimal(2);
  private lastRefresh = 0;
  private readonly isFakeMode = resolveLlmProvider(process.env) === "fake";

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRepository,
  ) {}

  async onModuleInit() {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    // RX-178: the provider record joined in. The soft-delete filter does not apply to this nested read, so
    // deletedAt and status are checked below.
    const aiModels = await this.prisma.aiModel.findMany({
      where: { active: true },
      include: {
        providerRecord: {
          select: { id: true, name: true, baseUrl: true, status: true, deletedAt: true, apiKeyCiphertext: true },
        },
        fallbacks: { orderBy: { position: "asc" }, select: { fallbackModel: { select: { slug: true } } } },
      },
    });
    const rateRows = await this.prisma.tierRate.findMany();
    const markupConfig = await this.prisma.appConfig.findUnique({
      where: { key: "markup_multiplier" },
    });

    const map = new Map<string, ModelConfig>();
    const connections = new Map<string, CachedConnection>();
    const fallbackSlugs = new Map<string, string[]>();
    for (const m of aiModels) {
      fallbackSlugs.set(m.slug, m.fallbacks.map((fallback) => fallback.fallbackModel.slug));
      const record = m.providerRecord;
      if (record && record.deletedAt === null && record.status === "active") {
        connections.set(m.slug, {
          providerRecordId: record.id,
          providerName: record.name,
          baseUrl: record.baseUrl,
          apiKeyCiphertext: record.apiKeyCiphertext,
        });
      }
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
    this.connections = connections;
    this.fallbackSlugs = fallbackSlugs;

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
      `Loaded ${map.size} models (${connections.size} on an active provider), ${rates.size} tier rates, markup=${this.markupMultiplier}`,
    );
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastRefresh > CACHE_TTL_MS) {
      await this.refresh();
    }
  }

  /**
   * RX-178 (D199): where a chat call for `slug` goes: its provider record's base URL and key (decrypted for this
   * call through ProviderRepository; the cache holds the ciphertext only) and the slug sent as `model`. An unknown
   * slug, a model without a provider record and an inactive or deleted provider are a ModelUnavailableException
   * (400). LLM_PROVIDER=fake skips the lookup (D199-5): no rows needed, and the fake sends nothing anywhere.
   * RNX-179: the connection carries the model's usable fallback models, in order (see resolveFallback).
   */
  async resolveConnection(slug: string): Promise<ModelConnection> {
    if (this.isFakeMode) return { slug, ...FAKE_CONNECTION };
    await this.ensureFresh();
    const cached = this.connections.get(slug);
    if (!cached) throw new ModelUnavailableException();
    const fallbacks = (this.fallbackSlugs.get(slug) ?? []).flatMap((fallbackSlug) => this.resolveFallback(slug, fallbackSlug));
    return { ...this.toConnection(slug, cached), fallbacks };
  }

  /** RX-178, RNX-179: the call's connection of one cached provider record (its key opened for this call), with the record id for its breaker. */
  private toConnection(slug: string, cached: CachedConnection): ModelConnection {
    return {
      slug,
      baseUrl: cached.baseUrl,
      apiKey: this.openKey(cached, slug),
      providerName: cached.providerName,
      providerRecordId: cached.providerRecordId,
    };
  }

  /**
   * RNX-179 (D149): one fallback of `slug` as a connection, or none when it cannot serve: an inactive model, an
   * inactive or deleted provider, a key that does not open, or a tier above the model's (raised after it was set as a
   * fallback). Each skip is logged.
   */
  private resolveFallback(slug: string, fallbackSlug: string): ModelConnection[] {
    const cached = this.connections.get(fallbackSlug);
    if (!cached) {
      this.logger.warn(`[resolveConnection] fallback ${fallbackSlug} of ${slug} skipped: the model or its provider is not active`);
      return [];
    }
    const tier = this.models.get(slug)?.tier ?? "";
    const fallbackTier = this.models.get(fallbackSlug)?.tier ?? "";
    if (isTierAbove(fallbackTier, tier)) {
      this.logger.warn(`[resolveConnection] fallback ${fallbackSlug} of ${slug} skipped: its tier ${fallbackTier} is above ${tier}`);
      return [];
    }
    try {
      return [this.toConnection(fallbackSlug, cached)];
    } catch {
      return [];
    }
  }

  /** RX-178 review N1: a stored key that does not open makes the provider unusable for chat: the fixed 400, the reason logged. */
  private openKey(cached: CachedConnection, slug: string): string {
    try {
      return this.providers.revealStoredKey(cached.apiKeyCiphertext);
    } catch {
      this.logger.warn(`[resolveConnection] provider ${cached.providerName}: the stored key does not open; refusing ${slug}`);
      throw new ModelUnavailableException();
    }
  }

  /** RX-178: the connection of the cheapest resolvable model of `tier`, for internal calls that name no model; 400 when there is none. */
  async resolveCheapestConnection(tier: string): Promise<ModelConnection> {
    const model = await this.getCheapestModel(tier);
    if (!model) throw new ModelUnavailableException();
    return this.resolveConnection(model.slug);
  }

  /**
   * RX-178 (D199-2): drops the cached connections of one provider record at once, in the process that deactivated,
   * deleted, re-keyed or re-pointed it; its models are refused from the next call. Other instances drop them at
   * their next refresh (60 s).
   */
  forgetProvider(providerRecordId: string): void {
    for (const [slug, cached] of this.connections) {
      if (cached.providerRecordId === providerRecordId) this.connections.delete(slug);
    }
  }

  /** RX-178 (D199-2): drops one deactivated model's cached connection at once in this process (others: within 60 s). */
  forgetModel(slug: string): void {
    this.connections.delete(slug);
  }

  /** RX-178: the next lookup reloads from the database (after an activation, so the new key is used at once). */
  expireCache(): void {
    this.lastRefresh = 0;
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

  /**
   * The models a chat call can resolve (RNX-192): active, on an active non-deleted provider record (the
   * connections map, as getCheapestModel); in LLM_PROVIDER=fake mode every active model. Every chat-facing list uses it.
   */
  async getAllModels(): Promise<ModelConfig[]> {
    await this.ensureFresh();
    return [...this.models.values()].filter((m) => this.isFakeMode || this.connections.has(m.slug));
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

  /**
   * Cheapest active model, optionally only among models of `tier`. RX-178: only a model a chat call can resolve
   * (on an active provider record; any model in LLM_PROVIDER=fake), since every caller sends it a request.
   */
  async getCheapestModel(tier?: string): Promise<ModelConfig | undefined> {
    await this.ensureFresh();
    const models = [...this.models.values()].filter(
      (m) => (!tier || m.tier === tier) && (this.isFakeMode || this.connections.has(m.slug)),
    );
    if (models.length === 0) return undefined;
    return models.sort(
      (a, b) =>
        a.inputPrice.add(a.outputPrice).toNumber() -
        b.inputPrice.add(b.outputPrice).toNumber(),
    )[0];
  }
}
