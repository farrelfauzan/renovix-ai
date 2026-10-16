import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";

/** The queries on `users`. A balance change takes the transaction as a required last argument. */
@Injectable()
export class UserRepository {
  /** Adds `amount` to this user's balance. Only inside a transaction. */
  incrementUserBalance(
    userId: string,
    amount: Prisma.Decimal,
    tx: DbTransaction,
  ) {
    return tx.user.update({
      where: { id: userId },
      data: {
        balance: { increment: amount },
      },
    });
  }
}
