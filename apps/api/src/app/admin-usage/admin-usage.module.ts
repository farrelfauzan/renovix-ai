import { Module } from "@nestjs/common";
import { OffersModule } from "../offers/offers.module";
import { AdminReconciliationController } from "./controller/admin-reconciliation.controller";
import { AdminUsageController } from "./controller/admin-usage.controller";
import { UsageRollupScheduler } from "./scheduler/usage-rollup.scheduler";
import { ReconciliationService } from "./service/reconciliation.service";
import { UsageAggregatesService } from "./service/usage-aggregates.service";
import { UsageReportService } from "./service/usage-report.service";

/**
 * Usage, cost and profit aggregates and provider reconciliation for the back office (RNX-228): /admin/usage and
 * /admin/reconciliation, and the daily rollup job. The settings come from OffersModule's PlatformSettingsService; the
 * repositories from RepositoriesModule.
 */
@Module({
  imports: [OffersModule],
  controllers: [AdminUsageController, AdminReconciliationController],
  providers: [UsageAggregatesService, UsageReportService, ReconciliationService, UsageRollupScheduler],
})
export class AdminUsageModule {}
