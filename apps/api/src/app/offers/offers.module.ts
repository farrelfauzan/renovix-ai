import { Module } from "@nestjs/common";
import { CatalogChangeRepository } from "./repository/catalog-change.repository";
import { CompanyContractRepository } from "./repository/company-contract.repository";
import { EnterpriseBundleRepository } from "./repository/enterprise-bundle.repository";
import { PackageRepository } from "./repository/package.repository";
import { PlatformSettingRepository } from "./repository/platform-setting.repository";
import { PurchaseSnapshotRepository } from "./repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "./repository/top-up-pack.repository";
import { CompanyContractService } from "./service/company-contract.service";
import { OfferCatalogService } from "./service/offer-catalog.service";
import { OfferSeedService } from "./service/offer-seed.service";
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
    PackageRepository,
    TopUpPackRepository,
    EnterpriseBundleRepository,
    CompanyContractRepository,
    PurchaseSnapshotRepository,
    PlatformSettingRepository,
    CatalogChangeRepository,
  ],
  exports: [OfferCatalogService, PlatformSettingsService, CompanyContractService, PurchaseSnapshotService],
})
export class OffersModule {}
