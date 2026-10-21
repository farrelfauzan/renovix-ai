import { Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { TransactionService } from "../../prisma/transaction.service";
import { CatalogChangeRepository } from "../../offers/repository/catalog-change.repository";
import { AiModelRepository } from "../repository/ai-model.repository";
import { AppConfigRepository } from "../repository/app-config.repository";
import { TierRateRepository } from "../../offers/repository/tier-rate.repository";
import { TIER_PLANNING_COST_PER_CREDIT } from "../../offers/config/tier-planning-cost-per-credit";
import { computeMixCostPerCredit } from "../utils/compute-mix-cost-per-credit";
import type { TokenKindValues } from "../types/token-kind-values";

/**
 * AppConfig keys the price refresh reads (RX-21). Both live in the app_configs table like
 * markup_multiplier, read here directly (the registry caches only model and tier-rate rows):
 * - `price_refresh_alert_ratio` (number, default 0.2): alert when a provider price moves by more
 *   than this fraction of the stored price, up or down.
 * - `tier_planning_cost_per_credit_<tier>` (positive dollar amount): replaces the tier's planning cost
 *   per credit from TIER_PLANNING_COST_PER_CREDIT (D237). Any other value is logged as an error and
 *   ignored (RNX-185: no fallback default).
 */
const ALERT_RATIO_CONFIG_KEY = "price_refresh_alert_ratio";
const PLANNING_COST_CONFIG_PREFIX = "tier_planning_cost_per_credit_";
const DEFAULT_ALERT_RATIO = new Decimal("0.2");
const POSITIVE_DOLLAR_AMOUNT = /^\d+(\.\d+)?$/;
const COST_DISPLAY_DECIMALS = 6;

/** The result of one price-refresh check (RX-21): what the run updated and alerted about. */
export interface PriceRefreshResult {
  /** Models whose prices the provider still reports, whether changed or not. */
  checked: number;
  updated: number;
  /** Models whose price moved more than the alert ratio. */
  alerted: number;
}

@Injectable()
export class ProviderPriceRefreshService {
  private readonly logger = new Logger(ProviderPriceRefreshService.name);

  constructor(
    private readonly models: AiModelRepository,
    private readonly rates: TierRateRepository,
    private readonly appConfig: AppConfigRepository,
    private readonly changes: CatalogChangeRepository,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * The price-refresh check (RX-21), callable directly (the scheduler calls it on its cron; a test
   * calls it without waiting). Fetches the provider's model list, updates every matching AiModel
   * row's input/output/cached prices and priceUpdatedAt, and alerts — Logger.error plus a
   * catalog_changes row — when a price moved more than `price_refresh_alert_ratio` or a model's
   * cost per credit at the token mix exceeds its tier's planning cost (RNX-185). No email (D50).
   */
  async checkProviderPrices(
    provider = "openrouter",
  ): Promise<PriceRefreshResult> {
    const listed = await this.listModels(provider);
    if (listed === undefined) {
      this.logger.warn(
        `Provider "${provider}" cannot list models (unsupported, or no LLM_API_KEY / OPENROUTER_API_KEY configured); price refresh skipped`,
      );
      return { checked: 0, updated: 0, alerted: 0 };
    }
    const listedById = new Map(listed.map((m) => [m.providerId, m]));
    const alertRatio = await this.readAlertRatio();
    const planningCosts = await this.readPlanningCosts();
    const rows = await this.models.findByProvider(provider);
    const result: PriceRefreshResult = { checked: 0, updated: 0, alerted: 0 };
    for (const row of rows) {
      const fresh = listedById.get(row.providerId);
      if (!fresh) continue;
      result.checked += 1;
    const changes = await this.collectChanges(row, fresh, alertRatio, planningCosts, provider);
      const changed =
        changes.input !== null || changes.output !== null || changes.cachedChanged;
      const mustAlert = changes.alerts.length > 0;
      if (!changed && !mustAlert) continue;
      if (mustAlert) result.alerted += 1;
      await this.writeUpdate(row, fresh, changes, result, provider);
    }
    return result;
  }

  /** The provider's model list, or undefined when the adapter has no list-models capability. */
  private async listModels(provider: string) {
    return this.listModelsOf(provider);
  }

  /** Injected late (setter injection avoids a ProvidersModule import cycle in tests). */
  private listModelsOf: (provider: string) => Promise<
    | {
        providerId: string;
        inputPrice: string | null;
        outputPrice: string | null;
        cachedInputPrice: string | null;
      }[]
    | undefined
  > = async () => undefined;

  /** The scheduler sets this to the router's listModels (kept out of the constructor for a plain test build). */
  setListModeler(
    listModels: (
      provider: string,
    ) => Promise<
      | {
          providerId: string;
          inputPrice: string | null;
          outputPrice: string | null;
          cachedInputPrice: string | null;
        }[]
      | undefined
    >,
  ) {
    this.listModelsOf = listModels;
  }

  /** Computes the three new prices and the alerts they raise, without writing anything. */
  private async collectChanges(
    row: {
      providerId: string;
      modelName: string;
      tier: string;
      inputPrice: Decimal;
      outputPrice: Decimal;
      cachedInputPrice: Decimal | null;
    },
    fresh: {
      providerId: string;
      inputPrice: string | null;
      outputPrice: string | null;
      cachedInputPrice: string | null;
    },
    alertRatio: Decimal,
    planningCosts: Map<string, Decimal>,
    provider: string,
  ): Promise<{
    input: Decimal | null;
    output: Decimal | null;
    cachedChanged: boolean;
    cachedPrice: Decimal | null;
    alerts: string[];
  }> {
    const alerts: string[] = [];
    const input = fresh.inputPrice !== null ? new Decimal(fresh.inputPrice) : null;
    const output = fresh.outputPrice !== null ? new Decimal(fresh.outputPrice) : null;
    const cachedPrice =
      fresh.cachedInputPrice !== null ? new Decimal(fresh.cachedInputPrice) : null;
    const moved = (oldPrice: Decimal, newPrice: Decimal | null): boolean =>
      newPrice !== null &&
      newPrice.sub(oldPrice).abs().greaterThan(oldPrice.mul(alertRatio));
    const inputChanged = input !== null && !input.eq(row.inputPrice);
    const outputChanged = output !== null && !output.eq(row.outputPrice);
    const cachedChanged =
      cachedPrice !== null &&
      (row.cachedInputPrice === null || !cachedPrice.eq(row.cachedInputPrice));
    if (moved(row.inputPrice, input) || moved(row.outputPrice, output)) {
      alerts.push(
        `Model ${row.providerId} (${row.modelName}, tier ${row.tier}): price moved more than ${alertRatio} of the stored price (input ${row.inputPrice} -> ${input ?? "unchanged"}, output ${row.outputPrice} -> ${output ?? "unchanged"})`,
      );
    }
    // The prices the row holds after this run: the provider's list price, the stored one where the
    // provider lists none; no cached price at all prices the cached share at the new-input price.
    const newInputPrice = input ?? row.inputPrice;
    const planningAlert = await this.findPlanningAlert(
      row,
      {
        newInput: newInputPrice,
        cachedInput: cachedPrice ?? row.cachedInputPrice ?? newInputPrice,
        output: output ?? row.outputPrice,
      },
      planningCosts,
      provider,
    );
    if (planningAlert !== null) alerts.push(planningAlert);
    return {
      input: inputChanged ? input : null,
      output: outputChanged ? output : null,
      cachedChanged,
      cachedPrice,
      alerts,
    };
  }

  /**
   * The planning-cost alert (RNX-185, docs/credits.md section 14.5): the model's cost per credit at the
   * token mix against its tier's planning cost, or null when it is not above it. A tier with no planning
   * cost, or whose rates blend to 0, logs an error naming the tier and gets no check (no default, D237).
   */
  private async findPlanningAlert(
    row: { providerId: string; modelName: string; tier: string },
    pricesPerToken: TokenKindValues,
    planningCosts: Map<string, Decimal>,
    provider: string,
  ): Promise<string | null> {
    const planningCost = planningCosts.get(row.tier);
    if (planningCost === undefined) {
      this.logger.error(
        `RNX-185: tier ${row.tier} has no planning cost per credit; planning-cost check skipped for model ${row.providerId}`,
      );
      return null;
    }
    const ratesPerMillionTokens = await this.readTierRates(row.tier);
    const costPerCredit = computeMixCostPerCredit({ pricesPerToken, ratesPerMillionTokens });
    if (!costPerCredit.isFinite()) {
      // The tier's rates blend to 0 at the mix: x / 0 is Infinity and 0 / 0 is NaN, neither a cost to compare.
      this.logger.error(
        `RNX-185: tier ${row.tier} has rates that blend to 0 at the token mix; planning-cost check skipped for model ${row.providerId}`,
      );
      return null;
    }
    if (!costPerCredit.greaterThan(planningCost)) return null;
    return `Model ${row.providerId} (${row.modelName}), tier ${row.tier}: costs ${costPerCredit.toFixed(COST_DISPLAY_DECIMALS)} dollars per credit, above the tier's planning cost ${planningCost.toFixed()} (price basis: ${provider} list price at the token mix 0.36 new input / 0.54 cached input / 0.10 output, over the tier rates blended at the same mix)`;
  }

  /** The tier's three rates (credits per 1,000,000 tokens) from the tier_rates table. */
  private async readTierRates(tier: string): Promise<TokenKindValues> {
    const rate = await this.rates.findRate(tier);
    // No seeded rate row: 1 credit per 1,000,000 tokens of every kind (the most expensive reading) so a
    // missing tier rate alerts rather than silently passing; the seed (bun run seed:tier-rates) always sets rows.
    return {
      newInput: rate?.inputCreditsPerToken ?? new Decimal(1),
      cachedInput: rate?.cachedCreditsPerToken ?? new Decimal(1),
      output: rate?.outputCreditsPerToken ?? new Decimal(1),
    };
  }

  /** Writes the update (if any price changed) and the alert's catalog_changes row, in one transaction. */
  private async writeUpdate(
    row: { id: string; providerId: string; modelName: string; tier: string; inputPrice: Decimal; outputPrice: Decimal; cachedInputPrice: Decimal | null },
    fresh: { inputPrice: string | null; outputPrice: string | null; cachedInputPrice: string | null },
    changes: Awaited<ReturnType<ProviderPriceRefreshService["collectChanges"]>>,
    result: PriceRefreshResult,
    provider: string,
  ): Promise<void> {
    await this.transactions.run(async (tx) => {
      const anyPriceChanged =
        changes.input !== null || changes.output !== null || changes.cachedChanged;
      if (anyPriceChanged) {
        await this.models.updatePrices(
          row.id,
          {
            inputPrice: changes.input ?? row.inputPrice,
            outputPrice: changes.output ?? row.outputPrice,
            cachedInputPrice: changes.cachedPrice ?? row.cachedInputPrice,
          },
          tx,
        );
        result.updated += 1;
      }
      if (changes.alerts.length === 0) return;
      const before = {
        inputPrice: row.inputPrice.toNumber(),
        outputPrice: row.outputPrice.toNumber(),
        cachedInputPrice: row.cachedInputPrice?.toNumber() ?? null,
      };
      const after = {
        inputPrice: changes.input?.toNumber() ?? before.inputPrice,
        outputPrice: changes.output?.toNumber() ?? before.outputPrice,
        cachedInputPrice: changes.cachedPrice?.toNumber() ?? before.cachedInputPrice,
      };
      for (const alert of changes.alerts) {
        this.logger.error(`RX-21 price alert: ${alert}`);
        await this.changes.create(
          {
            entity: "ai_model",
            entityId: row.id,
            changedBy: `price-refresh:${provider}`,
            reason: alert,
            before,
            after,
          },
          tx,
        );
      }
    });
  }

  private async readAlertRatio(): Promise<Decimal> {
    const value = await this.appConfig.findValue(ALERT_RATIO_CONFIG_KEY);
    return value !== null ? new Decimal(value) : DEFAULT_ALERT_RATIO;
  }

  /** Each tier's planning cost per credit: the D237 table, replaced per tier by a valid AppConfig row. */
  private async readPlanningCosts(): Promise<Map<string, Decimal>> {
    const rows = await this.appConfig.findValuesByKeyPrefix(PLANNING_COST_CONFIG_PREFIX);
    const costs = new Map<string, Decimal>();
    for (const [tier, cost] of Object.entries(TIER_PLANNING_COST_PER_CREDIT)) {
      costs.set(tier, new Decimal(cost));
    }
    for (const row of rows) {
      const tier = row.key.slice(PLANNING_COST_CONFIG_PREFIX.length);
      const value = row.value.trim();
      if (!POSITIVE_DOLLAR_AMOUNT.test(value) || new Decimal(value).isZero()) {
        this.logger.error(
          `RNX-185: AppConfig ${row.key} = "${row.value}" is not a positive dollar amount and is ignored; tier ${tier} keeps ${costs.get(tier)?.toFixed() ?? "no planning cost"}`,
        );
        continue;
      }
      costs.set(tier, new Decimal(value));
    }
    return costs;
  }
}
