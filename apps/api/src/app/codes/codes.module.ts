import { Module } from "@nestjs/common";
import { CodesService } from "./service/codes.service";
import { CodesController } from "./controller/codes.controller";
import { CreditLedgerService } from "../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../billing/service/package-ownership.service";

@Module({
  controllers: [CodesController],
  // CreditLedgerService needs only global providers (TransactionService, the repositories), so it is provided here
  // instead of importing BillingModule and its controller.
  providers: [CodesService, CreditLedgerService, PackageOwnershipService],
  exports: [CodesService],
})
export class CodesModule {}
