import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { CatalogChangeRepository } from "../repository/catalog-change.repository";
import { TierRateSeedDto } from "../dto/tier-rate-seed.dto";

/**
 * Applies the tier-rate seed file (prisma/tier-rates.seed.json, `bun run seed:tier-rates`, RX-21) in one
 * transaction: a tier with no row is created, a row whose rates changed is updated, and every write
 * records a catalog_changes row ("seed:<operator>", the file's reason) with the values before and after.
 * The rows store the file's values verbatim — CREDITS PER 1,000,000 TOKENS of each kind
 * (docs/credits.md section 1); the cost helpers apply section 1.3's formula (the token-weighted sum
 * of rates divided by 1,000,000). Idempotent: running the same file again writes nothing; a failure
 * rolls the whole run back.
 */
@Injectable()
export class TierRateSeedService {
  constructor(
    private readonly changes: CatalogChangeRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Writes what the seed file holds (as per-token rates); `operator` names who ran it. */
  async applySeed(seed: TierRateSeedDto, operator: string): Promise<void> {
    // The seed script validates the file before calling; re-validate here so no caller can
    // write rows the DTO would refuse (an unknown tier or a negative rate throws, writes nothing).
    const parsed = TierRateSeedDto.safeParse(seed);
    if (!parsed.success) {
      throw new Error(`Invalid tier-rate seed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    const changedBy = `seed:${operator}`;
    await this.transactions.run(async (tx) => {
      for (const rate of parsed.data.rates) {
        await this.saveTierRate(rate, changedBy, parsed.data.reason, tx);
      }
    });
  }

  /** Creates or updates one tier's rates (credits per 1,000,000 tokens, stored verbatim); unchanged writes nothing. */
  private async saveTierRate(
    rate: { tier: string; input: number; cached: number; output: number },
    changedBy: string,
    reason: string,
    tx: DbTransaction,
  ): Promise<void> {
    const existing = await tx.tierRate.findUnique({ where: { tier: rate.tier } });
    const after = {
      inputCreditsPerToken: rate.input,
      cachedCreditsPerToken: rate.cached,
      outputCreditsPerToken: rate.output,
    };
    const unchanged =
      existing !== null &&
      existing.inputCreditsPerToken.equals(after.inputCreditsPerToken) &&
      existing.cachedCreditsPerToken.equals(after.cachedCreditsPerToken) &&
      existing.outputCreditsPerToken.equals(after.outputCreditsPerToken);
    if (unchanged) return;
    const before =
      existing === null
        ? null
        : {
            inputCreditsPerToken: existing.inputCreditsPerToken.toNumber(),
            cachedCreditsPerToken: existing.cachedCreditsPerToken.toNumber(),
            outputCreditsPerToken: existing.outputCreditsPerToken.toNumber(),
          };
    const saved = await tx.tierRate.upsert({
      where: { tier: rate.tier },
      create: { tier: rate.tier, ...after },
      update: after,
    });
    await this.changes.create(
      {
        entity: "tier_rate",
        entityId: saved.tier,
        changedBy,
        reason,
        before: before ?? undefined,
        after: { ...after },
      },
      tx,
    );
  }
}
