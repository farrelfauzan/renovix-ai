import { Module } from "@nestjs/common";
import { BillingService } from "./service/billing.service";
import { BillingController } from "./controller/billing.controller";
import { CreditLedgerService } from "./service/credit-ledger.service";
import { CreditService } from "./service/credit.service";
import { CreditReservationSweepScheduler } from "./scheduler/credit-reservation-sweep.scheduler";

@Module({
  controllers: [BillingController],
  providers: [BillingService, CreditLedgerService, CreditService, CreditReservationSweepScheduler],
  exports: [BillingService, CreditLedgerService, CreditService],
})
export class BillingModule {}
