import { Module } from "@nestjs/common";
import { WebhookController } from "./controller/webhook.controller";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [BillingModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
