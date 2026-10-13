import { Module } from "@nestjs/common";
import { GowaWebhookController } from "./controller/gowa.webhook.controller";
import { GowaService } from "./service/gowa.service";
import { AgentModule } from "../agent/agent.module";
import { ProvidersModule } from "../providers/providers.module";
import { ConfigRegistryModule } from "../config/config-registry.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { DocumentModule } from "../document/document.module";
import { UsageModule } from "../usage/usage.module";
import { ChannelController } from "./controller/channel.controller";
import { ChannelService } from "./service/channel.service";
import { ChannelChatService } from "./service/channel-chat.service";

@Module({
  imports: [
    AgentModule,
    ProvidersModule,
    ConfigRegistryModule,
    KnowledgeModule,
    DocumentModule,
    UsageModule,
  ],
  controllers: [GowaWebhookController, ChannelController],
  providers: [GowaService, ChannelService, ChannelChatService],
  exports: [GowaService, ChannelService],
})
export class ChannelModule {}
