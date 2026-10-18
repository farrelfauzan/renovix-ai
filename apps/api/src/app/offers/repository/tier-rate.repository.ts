import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `tier_rates` (RX-21): one row per tier, written by the seed (`bun run seed:tier-rates`). */
@Injectable()
export class TierRateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every tier's rates. */
  findRates(tx?: DbTransaction) {
    return (tx ?? this.prisma).tierRate.findMany();
  }

  /** One tier's rates, or null when the tier has no row. */
  findRate(tier: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).tierRate.findUnique({ where: { tier } });
  }

  /** Creates or updates one tier's rates; the transaction is required because it writes. */
  upsertRate(
    tier: string,
    rates: {
      inputCreditsPerToken: Prisma.Decimal;
      cachedCreditsPerToken: Prisma.Decimal;
      outputCreditsPerToken: Prisma.Decimal;
    },
    tx: DbTransaction,
  ) {
    return tx.tierRate.upsert({
      where: { tier },
      create: { tier, ...rates },
      update: rates,
    });
  }
}
