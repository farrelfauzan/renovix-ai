import { Injectable, Logger } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { TransactionService } from "../../prisma/transaction.service";
import { CatalogChangeRepository } from "../../offers/repository/catalog-change.repository";
import { AiModelRepository } from "../repository/ai-model.repository";
import { AppConfigRepository } from "../repository/app-config.repository";
import { TierRateRepository } from "../../offers/repository/tier-rate.repository";

/**
 * The per-model cost of one credit's worth of input tokens under the tier rates (RX-21 planning
 * figure): price per token x input credits-per-token. When a tier's actual credits-per-credit cost
 * exceeds this, the tier is being sold below plan and the job alerts.
 */
// Planning defaults (dollars per credit served, docs/credits.md: "about $0.12 per credit" planned
// for Standard; higher tiers planned higher per the PRD 02 package table). Overrides:
// AppConfig key tier_planning_cost_per_credit_<tier>.
const PLANNING_COST_PER_CREDIT: Record<string, string> = {
  standard: "0.12",
  advanced: "0.12",
  premium: "0.15",
  frontier: "0.20",
};
const DEFAULT_PLANNING_COST_PER_CREDIT = new Decimal("0.25");

/**
 * AppConfig keys the price refresh reads (RX-21). Both live in the app_configs table like
 * markup_multiplier, read here directly (the registry caches only model and tier-rate rows):
 * - `price_refresh_alert_ratio` (number, default 0.2): alert when a provider price moves by more
 *   than this fraction of the stored price, up or down.
 * - `tier_planning_cost_per_credit_<tier>` (number, USD): overrides the code default for a tier's
 *   planning cost; when a tier's credits-per-credit cost (price x input rate) exceeds it, alert.
 */
const ALERT_RATIO_CONFIG_KEY = "price_refresh_alert_ratio";
const PLANNING_COST_CONFIG_PREFIX = "tier_planning_cost_per_credit_";
const DEFAULT_ALERT_RATIO = new Decimal("0.2");

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
   * catalog_changes row — when a price moved more than `price_refresh_alert_ratio` or a tier's
   * cost-per-credit exceeds its planning cost. No email (D50).
   */
  async checkProviderPrices(
    provider = "openrouter",
  ): Promise<PriceRefreshResult> {
    const listed = await this.listModels(provider);
    if (listed === undefined) {
      this.logger.warn(
        `Provider "${provider}" does not support listing models; price refresh skipped`,
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
    const changes = await this.collectChanges(row, fresh, alertRatio, planningCosts);
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
    const planningCost = planningCosts.get(row.tier);
    if (input !== null && planningCost !== undefined) {
      // Dollars per credit: the rate is credits per 1,000,000 tokens (docs/credits.md section 1),
      // so one credit buys 1,000,000/rate input tokens, each costing `input` dollars:
      // the provider cost of a credit is input x 1,000,000 / rate.
      const inputRate = await this.readTierInputRate(row.tier);
      if (inputRate.greaterThan(0)) {
        const costPerCredit = input.mul(1_000_000).div(inputRate);
        if (costPerCredit.greaterThan(planningCost)) {
          alerts.push(
            `Tier ${row.tier}: model ${row.providerId} costs ${costPerCredit.toFixed()} dollars per credit (input price / tier credits-per-token), above the planning cost ${planningCost.toFixed()}`,
          );
        }
      }
    }
    return {
      input: inputChanged ? input : null,
      output: outputChanged ? output : null,
      cachedChanged,
      cachedPrice,
      alerts,
    };
  }

  /** The dollars-per-credit figure needs the tier's input rate; read from the tier_rates table. */
  private async readTierInputRate(tier: string): Promise<Decimal> {
    const rate = await this.rates.findRate(tier);
    // No seeded rate row: 1 credit per token (the most expensive reading) so a missing tier rate
    // alerts rather than silently passing — the seed (bun run seed:tier-rates) always sets rows.
    return rate?.inputCreditsPerToken ?? new Decimal(1);
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

  private async readPlanningCosts(): Promise<Map<string, Decimal>> {
    const rows = await this.appConfig.findValuesByKeyPrefix(PLANNING_COST_CONFIG_PREFIX);
    const costs = new Map<string, Decimal>();
    for (const [tier, cost] of Object.entries(PLANNING_COST_PER_CREDIT)) {
      costs.set(tier, new Decimal(cost));
    }
    // An unknown tier has no code default; a config row may give it (or override a known tier's) one.
    for (const row of rows) {
      const tier = row.key.slice(PLANNING_COST_CONFIG_PREFIX.length);
      const cost = new Decimal(row.value);
      costs.set(tier, cost.greaterThan(0) ? cost : DEFAULT_PLANNING_COST_PER_CREDIT);
    }
    return costs;
  }
}
