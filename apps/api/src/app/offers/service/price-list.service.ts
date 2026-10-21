import { Injectable } from "@nestjs/common";
import { ExchangeRateService } from "../../exchange-rates/service/exchange-rate.service";
import { PackageRepository } from "../repository/package.repository";
import { TopUpPackRepository } from "../repository/top-up-pack.repository";
import type { PriceList } from "../types/price-list";
import { buildPriceList } from "../utils/build-price-list";

/**
 * The public price list (RNX-53, D237): the active top-up packs and listed packages at the rate a purchase would be
 * charged at now. It reads the rate the way a purchase does (lazy refresh, 7-day limit, the same 503). A fixed number
 * of queries whatever the number of offers: the rate read(s) and one call per offer table.
 */
@Injectable()
export class PriceListService {
  constructor(
    private readonly exchangeRates: ExchangeRateService,
    private readonly packs: TopUpPackRepository,
    private readonly packages: PackageRepository,
  ) {}

  /** The current price list in rupiah, with the rate it was converted at. 503 when no current rate exists. */
  async getPriceList(): Promise<PriceList> {
    const purchaseRate = await this.exchangeRates.getPurchaseRate();
    const now = new Date();
    const [topUpPacks, packages] = await Promise.all([this.packs.findActiveWithCurrentVersion(now), this.packages.findListedWithCurrentVersion(now)]);
    return buildPriceList({ purchaseRate, topUpPacks, packages });
  }
}
