import { Module } from "@nestjs/common";
import { CodesModule } from "../codes/codes.module";
import { OffersModule } from "../offers/offers.module";
import { AdminCodesController } from "./controller/admin-codes.controller";
import { AdminEnterpriseBundlesController } from "./controller/admin-enterprise-bundles.controller";
import { AdminPackagesController } from "./controller/admin-packages.controller";
import { AdminSettingsController } from "./controller/admin-settings.controller";
import { AdminTopUpPacksController } from "./controller/admin-top-up-packs.controller";
import { AdminCodesService } from "./service/admin-codes.service";
import { AdminEnterpriseBundlesService } from "./service/admin-enterprise-bundles.service";
import { AdminPackagesService } from "./service/admin-packages.service";
import { AdminSettingsService } from "./service/admin-settings.service";
import { AdminTopUpPacksService } from "./service/admin-top-up-packs.service";

/**
 * The offer catalog, invitation codes and platform settings through the admin API (RNX-226, the backend of RNX-98):
 * /admin/packages, /admin/top-up-packs, /admin/enterprise-bundles, /admin/codes and /admin/settings. It writes only
 * through OffersModule's OfferCatalogService and PlatformSettingsService and CodesModule's CodesService, on the
 * audit transaction of the route; the repositories come from RepositoriesModule.
 */
@Module({
  imports: [OffersModule, CodesModule],
  controllers: [AdminPackagesController, AdminTopUpPacksController, AdminEnterpriseBundlesController, AdminCodesController, AdminSettingsController],
  providers: [AdminPackagesService, AdminTopUpPacksService, AdminEnterpriseBundlesService, AdminCodesService, AdminSettingsService],
})
export class AdminCatalogModule {}
