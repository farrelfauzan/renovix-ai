import { Module } from "@nestjs/common";
import { BillingService } from "./service/billing.service";
import { BillingController } from "./controller/billing.controller";

@Module({
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
