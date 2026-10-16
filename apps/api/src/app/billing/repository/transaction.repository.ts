import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";

/** The queries on `transactions`, the ledger. A ledger write takes the transaction as a required last argument. */
@Injectable()
export class TransactionRepository {
  /** Writes the successful top-up row of this user for `amount`. Only inside a transaction. */
  createTopupTransaction(
    userId: string,
    amount: Prisma.Decimal,
    reference: string,
    tx: DbTransaction,
  ) {
    return tx.transaction.create({
      data: {
        userId,
        amount,
        type: "topup",
        status: "success",
        reference,
      },
    });
  }
}
