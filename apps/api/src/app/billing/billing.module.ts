import { Module } from "@nestjs/common";
import { OffersModule } from "../offers/offers.module";
import { BillingService } from "./service/billing.service";
import { BillingController } from "./controller/billing.controller";
import { CreditLedgerService } from "./service/credit-ledger.service";
import { CreditService } from "./service/credit.service";
import { WeeklyFreeResetService } from "./service/weekly-free-reset.service";
import { CreditReservationSweepScheduler } from "./scheduler/credit-reservation-sweep.scheduler";
import { WeeklyFreeResetScheduler } from "./scheduler/weekly-free-reset.scheduler";

@Module({
  // RNX-321: the weekly reset reads the allowance from the platform settings (PlatformSettingsService).
  imports: [OffersModule],
  controllers: [BillingController],
  providers: [
    BillingService,
    CreditLedgerService,
    CreditService,
    CreditReservationSweepScheduler,
    WeeklyFreeResetService,
    WeeklyFreeResetScheduler,
  ],
  exports: [BillingService, CreditLedgerService, CreditService],
})
export class BillingModule {}
