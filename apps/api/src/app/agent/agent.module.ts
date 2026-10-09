import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller";
import { AgentRunController } from "./agent-run.controller";
import { AgentService } from "./agent.service";
import { AgentRunService } from "./agent-run.service";
import { AgentToolService } from "./agent-tool.service";
import { AgentMemoryService } from "./agent-memory.service";
import { BillingModule } from "../billing/billing.module";
import { ProvidersModule } from "../providers/providers.module";
import { UsageModule } from "../usage/usage.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { ConfigRegistryModule } from "../config/config-registry.module";
import { DocumentModule } from "../document/document.module";
import { McpModule } from "../mcp/mcp.module";
import { WorkspaceModule } from "../workspace/workspace.module";

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
  ],
  controllers: [AgentController, AgentRunController],
  providers: [
    AgentService,
    AgentRunService,
    AgentToolService,
    AgentMemoryService,
  ],
  exports: [
    AgentService,
    AgentRunService,
    AgentToolService,
    AgentMemoryService,
  ],
})
export class AgentModule {}
