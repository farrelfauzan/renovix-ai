import { BadRequestException, Injectable } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { UserRepository } from "../../auth/repository/user.repository";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import type { CreditAccountOwner } from "../../billing/types/credit-account-owner";
import { CompanyContractRepository } from "../../offers/repository/company-contract.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import type { CreditAdjustmentOutcome } from "../types/credit-adjustment-outcome";
import type { CreditAdjustmentRequest } from "../types/credit-adjustment-request";
import { buildCreditAdjustmentOutcome } from "../utils/build-credit-adjustment-outcome";

/**
 * Back-office credit adjustments (RNX-227, docs/credits.md I7: a correction is a new `adjustment` entry with a
 * reason). Each one is a ledger entry appended by CreditLedgerService, never a balance edit, on the target's paid
 * wallet (a company pool has only that one).
 */
@Injectable()
export class CreditAdjustmentService {
  constructor(
    private readonly ledger: CreditLedgerService,
    private readonly users: UserRepository,
    private readonly contracts: CompanyContractRepository,
  ) {}

  /**
   * Appends one `adjustment` entry in `tx` (the audit transaction): signed amount (negative to remove),
   * memberUserId = the admin, reference = the action id, idempotency key `adjustment:<key>`. 400 for an unknown
   * user or a company without a contract. The ledger refuses a removal below the held credits or 0 (402, I5) and a
   * key already used with another amount (409); the same key again returns the first entry and writes nothing (I8).
   */
  async adjust(request: CreditAdjustmentRequest, tx: DbTransaction): Promise<CreditAdjustmentOutcome> {
    const { adminId, actionId, adjustment } = request;
    await this.assertKnownTarget(adjustment.target, tx);
    const credits = new Decimal(adjustment.amount);
    const entry = await this.ledger.appendEntry(
      {
        owner: adjustment.target,
        wallet: "paid",
        type: "adjustment",
        amount: adjustment.direction === "remove" ? credits.negated() : credits,
        memberUserId: adminId,
        reference: actionId,
        idempotencyKey: `adjustment:${adjustment.idempotencyKey}`,
      },
      tx,
    );
    return buildCreditAdjustmentOutcome(entry, request);
  }

  /** 400 unless the user exists, or the company has a contract (there is no company table). */
  private async assertKnownTarget(target: CreditAccountOwner, tx: DbTransaction): Promise<void> {
    const isKnown =
      target.userId === undefined
        ? await this.contracts.hasContractForCompany(target.companyId, tx)
        : (await this.users.findPortalUser(target.userId, tx)) !== null;
    if (!isKnown) throw new BadRequestException("Unknown target");
  }
}
