import { Module } from "@nestjs/common";
import { CompanyContractService } from "./service/company-contract.service";
import { OfferCatalogService } from "./service/offer-catalog.service";
import { OfferSeedService } from "./service/offer-seed.service";
import { TierRateSeedService } from "./service/tier-rate-seed.service";
import { PlatformSettingsService } from "./service/platform-settings.service";
import { PurchaseSnapshotService } from "./service/purchase-snapshot.service";

/**
 * Offer catalog, purchase snapshots, company contracts and platform settings (RX-86). No controller: no route
 * reads or writes them yet (catalog screens RX-98, checkout RX-35, enforcement RX-76).
 */
@Module({
  providers: [
    OfferCatalogService,
    PlatformSettingsService,
    CompanyContractService,
    PurchaseSnapshotService,
    OfferSeedService,
    TierRateSeedService,
  ],
  exports: [OfferCatalogService, PlatformSettingsService, CompanyContractService, PurchaseSnapshotService],
})
export class OffersModule {}
