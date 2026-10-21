import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { RepositoriesModule } from "./prisma/repositories.module";
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
import { ExchangeRatesModule } from "./exchange-rates/exchange-rates.module";
import { AdminAuditModule } from "./admin-auth/admin-audit.module";
import { AdminProvidersModule } from "./admin-providers/admin-providers.module";
import { AdminAuditInterceptor } from "./admin-auth/interceptor/admin-audit.interceptor";
import { AccessModule } from "../common/access.module";
import { GlobalExceptionFilter } from "../common/filters/global-exception.filter";
import { AccessGuard } from "../common/guards/access.guard";
import { AdminOriginGuard } from "../common/guards/admin-origin.guard";
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
    RepositoriesModule,
    ProvidersModule,
    ConfigRegistryModule,
    AuthModule,
    ChatModule,
    BillingModule,
    UsageModule,
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
    ExchangeRatesModule,
    AdminAuditModule,
    AdminProvidersModule,
    AccessModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // RX-156: first, so a refused /admin request reaches neither the throttler's count nor a session check.
    { provide: APP_GUARD, useExisting: AdminOriginGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AccessGuard },
    // RX-97: the back-office audit hook, on every route that declares @AdminAudit.
    { provide: APP_INTERCEPTOR, useExisting: AdminAuditInterceptor },
    // RNX-171: an error after a reply's headers were sent ends that reply; any other error is answered as before.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
