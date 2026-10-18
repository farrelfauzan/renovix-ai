import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ProviderRouter } from "../../providers/provider-router";
import { ProviderPriceRefreshService } from "../service/provider-price-refresh.service";

/**
 * The daily provider price refresh (RX-21): every day at 02:00 Asia/Jakarta it asks the provider
 * adapter for its model list and updates the matching AiModel rows' prices, alerting (Logger.error
 * plus a catalog_changes row, no email — D50) on a price that moved more than the alert ratio or a
 * tier whose cost-per-credit exceeds its planning cost. The check itself is
 * ProviderPriceRefreshService.checkProviderPrices, callable directly by a test.
 */
@Injectable()
export class ProviderPriceRefreshScheduler {
  constructor(
    private readonly refresh: ProviderPriceRefreshService,
    private readonly providerRouter: ProviderRouter,
  ) {
    this.refresh.setListModeler((provider) =>
      this.providerRouter.listModels(provider),
    );
  }

  @Cron("0 2 * * *", { timeZone: "Asia/Jakarta" })
  async refreshProviderPrices(): Promise<void> {
    await this.refresh.checkProviderPrices("openrouter");
  }
}
