import { Module } from "@nestjs/common";
import { CreditLedgerService } from "../billing/service/credit-ledger.service";
import { AdminCreditsController } from "./controller/admin-credits.controller";
import { CreditAdjustmentService } from "./service/credit-adjustment.service";

/**
 * Back-office credit adjustments (RNX-227): POST /admin/credits/adjustments. No screen yet (RNX-99).
 * CreditLedgerService needs only global providers (TransactionService, the repositories from RepositoriesModule),
 * so it is provided here instead of importing BillingModule and its controller (as CodesModule does).
 */
@Module({
  controllers: [AdminCreditsController],
  providers: [CreditAdjustmentService, CreditLedgerService],
})
export class AdminCreditsModule {}
