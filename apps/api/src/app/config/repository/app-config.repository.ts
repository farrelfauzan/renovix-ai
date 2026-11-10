import { Injectable } from "@nestjs/common";
import type { AppConfig } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `app_configs` (RX-21): key/value rows the price refresh reads; the web search policy and usage (RNX-140). */
@Injectable()
export class AppConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One config value by its exact key. */
  findValue(key: string) {
    return this.prisma.appConfig
      .findUnique({ where: { key }, select: { value: true } })
      .then((row) => row?.value ?? null);
  }

  /** Every config row whose key starts with the prefix. */
  findValuesByKeyPrefix(prefix: string) {
    return this.prisma.appConfig.findMany({
      where: { key: { startsWith: prefix } },
      select: { key: true, value: true },
    });
  }

  /** Stores the value under its exact key, or replaces the value of that key (RNX-140: the web search policy and usage). */
  upsertValue(key: string, value: string, tx?: DbTransaction): Promise<AppConfig> {
    return (tx ?? this.prisma).appConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  /**
   * Adds one to the counter stored as the value of `key`, creating it at 1, unless it is at `limit` (RNX-294: one
   * INSERT ... ON CONFLICT DO UPDATE, so two calls at the same time never both take the last slot). The new count,
   * or null when the counter is at the limit (a limit below 1 never creates the row).
   */
  async incrementCounterBelowLimit(key: string, limit: number): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ value: string }[]>`
      INSERT INTO "app_configs" ("id", "key", "value")
      SELECT gen_random_uuid()::text, ${key}, '1' WHERE ${limit}::int >= 1
      ON CONFLICT ("key") DO UPDATE
      SET "value" = ("app_configs"."value"::int + 1)::text
      WHERE "app_configs"."value"::int < ${limit}::int
      RETURNING "value"`;
    return rows.length > 0 ? Number(rows[0].value) : null;
  }

  /**
   * Takes one off the counter stored as the value of `key`, never below 0, in one UPDATE (RNX-294: gives back a
   * slot `incrementCounterBelowLimit` took). A counter back at 0 is deleted, as if it had never been taken; the
   * delete only matches a row still at 0, so a slot taken in between stays.
   */
  async decrementCounter(key: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ value: string }[]>`
      UPDATE "app_configs" SET "value" = ("value"::int - 1)::text
      WHERE "key" = ${key} AND "value"::int > 0
      RETURNING "value"`;
    if (rows[0]?.value !== "0") return;
    await this.prisma.$executeRaw`DELETE FROM "app_configs" WHERE "key" = ${key} AND "value" = '0'`;
  }
}
