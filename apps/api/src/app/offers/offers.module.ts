import { Module } from "@nestjs/common";
import { ExchangeRatesModule } from "../exchange-rates/exchange-rates.module";
import { EntitlementsController } from "./controller/entitlements.controller";
import { PricesController } from "./controller/prices.controller";
import { CompanyContractService } from "./service/company-contract.service";
import { OfferCatalogService } from "./service/offer-catalog.service";
import { OfferSeedService } from "./service/offer-seed.service";
import { TierRateSeedService } from "./service/tier-rate-seed.service";
import { PlatformSettingsService } from "./service/platform-settings.service";
import { PurchaseSnapshotService } from "./service/purchase-snapshot.service";
import { EntitlementService } from "./service/entitlement.service";
import { MyEntitlementsService } from "./service/my-entitlements.service";
import { PriceListService } from "./service/price-list.service";

/**
 * Offer catalog, purchase snapshots, company contracts and platform settings (RX-86). One public route: the
 * read-only price list in rupiah (RNX-53, D237). Catalog screens RX-98, checkout RX-35 and enforcement RX-76 come later.
 */
@Module({
  // RNX-53: a purchase is charged at the stored USD to IDR rate.
  imports: [ExchangeRatesModule],
  controllers: [PricesController, EntitlementsController],
  providers: [
    PriceListService,
    OfferCatalogService,
    PlatformSettingsService,
    CompanyContractService,
    PurchaseSnapshotService,
    EntitlementService,
    MyEntitlementsService,
    OfferSeedService,
    TierRateSeedService,
  ],
  exports: [OfferCatalogService, PlatformSettingsService, CompanyContractService, PurchaseSnapshotService, EntitlementService],
})
export class OffersModule {}
