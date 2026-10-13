import { Module } from "@nestjs/common";
import { ChatController } from "./controller/chat.controller";
import { ChatService } from "./service/chat.service";
import { ConversationController } from "./controller/conversation.controller";
import { ConversationService } from "./service/conversation.service";
import { ModelsController } from "./controller/models.controller";
import { PromptTemplateService } from "./service/prompt-template.service";
import { PromptTuningService } from "./service/prompt-tuning.service";
import { BillingModule } from "../billing/billing.module";
import { ProvidersModule } from "../providers/providers.module";
import { UsageModule } from "../usage/usage.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { DocumentModule } from "../document/document.module";
import { MemoryModule } from "../memory/memory.module";

@Module({
  imports: [
    BillingModule,
    ProvidersModule,
    UsageModule,
    KnowledgeModule,
    DocumentModule,
    MemoryModule,
  ],
  controllers: [ChatController, ConversationController, ModelsController],
  providers: [
    ChatService,
    ConversationService,
    PromptTemplateService,
    PromptTuningService,
  ],
  exports: [ConversationService, PromptTuningService],
})
export class ChatModule {}
