import { Module } from "@nestjs/common";
import { PortalController } from "./controller/portal.controller";
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
  controllers: [PortalController],
  providers: [PortalTierService],
})
export class PortalModule {}
