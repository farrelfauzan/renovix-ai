import { Module } from "@nestjs/common";
import { PortalController } from "./controller/portal.controller";
import { CreditMeterController } from "./controller/credit-meter.controller";
import { CreditEstimateController } from "./controller/credit-estimate.controller";
import { CreditEstimateService } from "./service/credit-estimate.service";
import { CreditMeterService } from "./service/credit-meter.service";
import { CreditWarningService } from "./service/credit-warning.service";
import { CreditWarningScheduler } from "./scheduler/credit-warning.scheduler";
import { PortalTierService } from "./service/portal-tier.service";
import { BillingModule } from "../billing/billing.module";
import { ProvidersModule } from "../providers/providers.module";
import { UsageModule } from "../usage/usage.module";
import { ChatModule } from "../chat/chat.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { DocumentModule } from "../document/document.module";
import { MemoryModule } from "../memory/memory.module";
import { OffersModule } from "../offers/offers.module";

@Module({
  imports: [
    BillingModule,
    ProvidersModule,
    UsageModule,
    ChatModule,
    KnowledgeModule,
    DocumentModule,
    MemoryModule,
    OffersModule,
  ],
  controllers: [PortalController, CreditMeterController, CreditEstimateController],
  providers: [PortalTierService, CreditMeterService, CreditEstimateService, CreditWarningService, CreditWarningScheduler],
})
export class PortalModule {}
