import { Module } from "@nestjs/common";
import { ReminderController } from "./controller/reminder.controller";
import { ReminderService } from "./service/reminder.service";
import { ReminderScheduler } from "./scheduler/reminder.scheduler";
import { ChannelModule } from "../channel/channel.module";
import { AgentModule } from "../agent/agent.module";
import { ProvidersModule } from "../providers/providers.module";
import { ConfigRegistryModule } from "../config/config-registry.module";
import { UsageModule } from "../usage/usage.module";

@Module({
  imports: [
    ChannelModule,
    AgentModule,
    ProvidersModule,
    ConfigRegistryModule,
    UsageModule,
  ],
  controllers: [ReminderController],
  providers: [ReminderService, ReminderScheduler],
  exports: [ReminderService],
})
export class ReminderModule {}
