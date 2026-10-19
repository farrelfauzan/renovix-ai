import { Module } from "@nestjs/common";
import { BillingService } from "./service/billing.service";
import { BillingController } from "./controller/billing.controller";
import { CreditLedgerService } from "./service/credit-ledger.service";

@Module({
  controllers: [BillingController],
  providers: [BillingService, CreditLedgerService],
  exports: [BillingService, CreditLedgerService],
})
export class BillingModule {}
