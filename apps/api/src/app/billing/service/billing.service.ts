import { Injectable } from "@nestjs/common";
import { Decimal } from "@prisma/client/runtime/client";
import { CreditLedgerService } from "./credit-ledger.service";

@Injectable()
export class BillingService {
  constructor(private readonly creditLedger: CreditLedgerService) {}

  /**
   * Add balance (for top-ups): one `top_up` ledger entry on the user's paid wallet (RX-22, docs/credits.md section
   * 2.1), with the payment's reference; the same reference again writes nothing (I8). A zero amount writes no entry
   * (D186: grants are > 0). The ledger is the only balance (RNX-186 removed User.balance and the Transaction table).
   */
  async addBalance(
    userId: string,
    amount: Decimal,
    reference: string,
  ): Promise<void> {
    if (amount.isZero()) return;
    await this.creditLedger.appendEntry({
      owner: { userId },
      wallet: "paid",
      type: "top_up",
      amount,
      memberUserId: userId,
      reference,
      idempotencyKey: `top_up:${reference}`,
    });
  }
}
