import { Injectable, Logger } from "@nestjs/common";
import { FRANKFURTER_SOURCE } from "../../exchange-rates/config/frankfurter-source";
import { ExchangeRateRepository } from "../../exchange-rates/repository/exchange-rate.repository";
import type { PurchaseRate } from "../../exchange-rates/types/purchase-rate";
import { isRateTooOld } from "../../exchange-rates/utils/is-rate-too-old";
import { ModelCallCostRepository } from "../repository/model-call-cost.repository";
import type { ModelCallCostInput } from "../types/model-call-cost-input";
import { toModelCallCostRow } from "../utils/to-model-call-cost-row";

/**
 * RNX-162 (D243 decision 38): writes what each model call cost us (model_call_costs), called by CreditService right
 * after the call's usage entry commits, on every path that writes one.
 */
@Injectable()
export class ModelCallCostService {
  private readonly logger = new Logger(ModelCallCostService.name);

  constructor(
    private readonly costs: ModelCallCostRepository,
    private readonly exchangeRates: ExchangeRateRepository,
  ) {}

  /**
   * Writes the call's row when its usage record names a cost source (nothing otherwise), with the latest usable USD
   * to IDR rate (rupiah null without one). Never throws: cost capture never refuses or fails a model call, so a failed
   * write is logged with the call id only and the call goes on.
   */
  async record({ entry, record }: ModelCallCostInput): Promise<void> {
    if (!record.cost) return;
    try {
      const rate = await this.findUsableRate();
      await this.costs.create(toModelCallCostRow({ entry, record, source: record.cost, rate }));
    } catch {
      this.logger.error(`Failed to record the model call cost of call ${record.callId}`);
    }
  }

  /**
   * The latest stored USD to IDR rate when RNX-53's rule allows it (MAX_RATE_AGE_DAYS old or newer), else null (none,
   * or too old). It reads only: unlike ExchangeRateService.getPurchaseRate, no refresh (no request to the source on
   * a model call's path), no owner notification and no 503.
   */
  private async findUsableRate(): Promise<PurchaseRate | null> {
    const latest = await this.exchangeRates.findLatest(FRANKFURTER_SOURCE.base, FRANKFURTER_SOURCE.quote);
    if (!latest || isRateTooOld({ rateDate: latest.rateDate, now: new Date() })) return null;
    return { rate: latest.rate, rateDate: latest.rateDate, source: latest.source };
  }
}
