import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "./db-transaction";
import { PrismaService } from "./prisma.service";

/** Lets a service run the calls of several repositories in one database transaction. */
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` in one transaction and gives it the transaction to pass to every repository call.
   * Without `tx` it opens a transaction, with `options` (isolationLevel, timeout, maxWait) if given.
   * With `tx` it joins that open transaction and opens nothing: a failure that reaches the outer `run`
   * rolls back the whole outer transaction (one the outer work catches undoes nothing), and `options`
   * are refused because they could not be honoured.
   * Never hold a transaction open across a model call or a stream.
   */
  async run<T>(
    work: (tx: DbTransaction) => Promise<T>,
    options?: Parameters<PrismaService["$transaction"]>[1],
    tx?: DbTransaction,
  ): Promise<T> {
    if (!tx) return this.prisma.$transaction(work, options);
    if (options) {
      throw new Error(
        "TransactionService.run: options cannot be applied when joining an open transaction; pass them where the transaction is opened.",
      );
    }
    return work(tx);
  }
}
