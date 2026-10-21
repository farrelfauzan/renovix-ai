import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { NewExchangeRate } from "../types/new-exchange-rate";

/** The queries on `exchange_rates` (RNX-53). A rate row is never deleted and its rate never changes. */
@Injectable()
export class ExchangeRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores the rate once per base, quote, rate date and source, whichever instance runs first (one INSERT ... ON
   * CONFLICT). A later fetch of the same rate date only moves fetched_at forward, so the lazy refresh (D237) does not
   * fetch again on every quote while the source has no newer rate (weekends). Raw SQL: Prisma's createMany cannot
   * update on conflict, and its upsert does not promise one statement for a compound key.
   */
  async saveFetchedRate(data: NewExchangeRate): Promise<void> {
    const rateDate = data.rateDate.toISOString().slice(0, 10);
    await this.prisma.$executeRaw`
      INSERT INTO "exchange_rates" ("id", "base", "quote", "rate", "rate_date", "fetched_at", "source")
      VALUES (${randomUUID()}, ${data.base}, ${data.quote}, ${data.rate.toString()}::numeric, ${rateDate}::date, ${data.fetchedAt}, ${data.source})
      ON CONFLICT ("base", "quote", "rate_date", "source")
      DO UPDATE SET "fetched_at" = GREATEST("exchange_rates"."fetched_at", EXCLUDED."fetched_at")`;
  }

  /** The newest rate of this pair (by its own date, then fetch time), served by the unique index's (base, quote, rate_date) prefix. */
  findLatest(base: string, quote: string) {
    return this.prisma.exchangeRate.findFirst({ where: { base, quote }, orderBy: [{ rateDate: "desc" }, { fetchedAt: "desc" }] });
  }
}
