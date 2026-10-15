import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { BillingModule } from "./billing/billing.module";
import { UsageModule } from "./usage/usage.module";
import { ProvidersModule } from "./providers/providers.module";
import { WebhookModule } from "./webhooks/webhook.module";
import { HealthModule } from "./health/health.module";
import { ConfigRegistryModule } from "./config/config-registry.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { PortalModule } from "./portal/portal.module";
import { DocumentModule } from "./document/document.module";
import { AgentModule } from "./agent/agent.module";
import { ChannelModule } from "./channel/channel.module";
import { EmailModule } from "./email/email.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { McpModule } from "./mcp/mcp.module";
import { GuardrailModule } from "./guardrail/guardrail.module";
import { ReminderModule } from "./reminder/reminder.module";
import { CodesModule } from "./codes/codes.module";
import { AdminAuthModule } from "./admin-auth/admin-auth.module";
import { OffersModule } from "./offers/offers.module";
import { AccessModule } from "../common/access.module";
import { AccessGuard } from "../common/guards/access.guard";
import { clientIp } from "../common/utils/client-ip";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60000,
          limit: 60,
        },
      ],
      // RX-155: count per client with the D48 rule, not per proxy (request.ip).
      getTracker: (req) => clientIp(req as FastifyRequest),
    }),
    PrismaModule,
    ConfigRegistryModule,
    AuthModule,
    ChatModule,
    BillingModule,
    UsageModule,
    ProvidersModule,
    WebhookModule,
    HealthModule,
    KnowledgeModule,
    PortalModule,
    DocumentModule,
    AgentModule,
    ChannelModule,
    EmailModule,
    WorkspaceModule,
    McpModule,
    GuardrailModule,
    ReminderModule,
    CodesModule,
    AdminAuthModule,
    OffersModule,
    AccessModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AccessGuard },
  ],
})
export class AppModule {}
