import { Module } from "@nestjs/common";
import { AgentController } from "./controller/agent.controller";
import { AgentRunController } from "./controller/agent-run.controller";
import { AgentService } from "./service/agent.service";
import { AgentRunService } from "./service/agent-run.service";
import { AgentRunMeterService } from "./service/agent-run-meter.service";
import { AgentToolService } from "./service/agent-tool.service";
import { AgentMemoryService } from "./service/agent-memory.service";
import { BillingModule } from "../billing/billing.module";
import { ProvidersModule } from "../providers/providers.module";
import { UsageModule } from "../usage/usage.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ConfigRegistryModule } from "../config/config-registry.module";
import { DocumentModule } from "../document/document.module";
import { McpModule } from "../mcp/mcp.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { OffersModule } from "../offers/offers.module";

@Module({
  imports: [
    BillingModule,
    ProvidersModule,
    UsageModule,
    KnowledgeModule,
    ConfigRegistryModule,
    DocumentModule,
    McpModule,
    WorkspaceModule,
    OffersModule,
  ],
  controllers: [AgentController, AgentRunController],
  providers: [
    AgentService,
    AgentRunService,
    AgentRunMeterService,
    AgentToolService,
    AgentMemoryService,
  ],
  exports: [
    AgentService,
    AgentRunService,
    AgentRunMeterService,
    AgentToolService,
    AgentMemoryService,
  ],
})
export class AgentModule {}
