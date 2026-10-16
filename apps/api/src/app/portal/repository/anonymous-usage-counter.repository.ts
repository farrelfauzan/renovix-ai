import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The queries on `anonymous_usage_counters` (the free tier's daily counters, RX-10). Every method takes the
 * transaction as its last argument: optional, and required on the count (`incrementCounterBelowCap`), which
 * counts only together with the session and the other counter of the same reservation.
 */
@Injectable()
export class AnonymousUsageCounterRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Adds one to the counter of this bucket and day unless it is at `cap` (one INSERT ... ON CONFLICT DO
   * UPDATE, so two requests at the same time both count and never pass the cap). True when counted.
   * Only inside a transaction.
   */
  async incrementCounterBelowCap(
    bucket: string,
    day: string,
    cap: number,
    tx: DbTransaction,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<unknown[]>`
      INSERT INTO "anonymous_usage_counters" ("bucket", "day", "count")
      VALUES (${bucket}, ${day}::date, 1)
      ON CONFLICT ("bucket", "day") DO UPDATE
      SET "count" = "anonymous_usage_counters"."count" + 1
      WHERE "anonymous_usage_counters"."count" < ${cap}
      RETURNING "count"`;
    return rows.length > 0;
  }

  /** Deletes the counters of the days before `before`. */
  deleteCountersBefore(before: Date, tx?: DbTransaction) {
    return (tx ?? this.prisma).anonymousUsageCounter.deleteMany({
      where: { day: { lt: before } },
    });
  }
}
