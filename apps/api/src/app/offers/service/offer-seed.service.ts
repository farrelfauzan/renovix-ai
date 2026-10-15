import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import type { OfferSeedDto } from "../dto/offer-seed.dto";
import type { ChangeAuthor } from "../types/change-author";
import { OfferCatalogService } from "./offer-catalog.service";
import { PlatformSettingsService } from "./platform-settings.service";

/**
 * Applies the seed file (prisma/offers.seed.json, `bun run seed:offers`) in one transaction: settings, packages,
 * top-up packs and Enterprise bundles, each through the services, so every change is validated and writes its
 * change record ("seed:<operator>", the file's reason). Idempotent: an unchanged file writes nothing, and changed
 * terms create a new version, never edit one. A failure rolls the whole run back.
 */
@Injectable()
export class OfferSeedService {
  constructor(
    private readonly catalog: OfferCatalogService,
    private readonly settings: PlatformSettingsService,
    private readonly transactions: TransactionService,
  ) {}

  /** Writes what the seed file holds; `operator` names who ran it. */
  async applySeed(seed: OfferSeedDto, operator: string): Promise<void> {
    const author: ChangeAuthor = { changedBy: `seed:${operator}`, reason: seed.reason };
    await this.transactions.run(async (tx) => {
      for (const [name, value] of Object.entries(seed.settings)) await this.settings.saveSetting({ name, value, author }, tx);
      await this.seedPackages(seed, author, tx);
      await this.seedTopUpPacks(seed, author, tx);
      await this.seedEnterpriseBundles(seed, author, tx);
    });
  }

  /** Saves each package, and its version when the file gives one (allowed tiers from the file's default when left out). */
  private async seedPackages(seed: OfferSeedDto, author: ChangeAuthor, tx: DbTransaction): Promise<void> {
    for (const { version, ...fields } of seed.packages) {
      const saved = await this.catalog.savePackage(fields, author, tx);
      if (!version) continue;
      const { effectiveFrom, ...terms } = version;
      await this.catalog.savePackageVersion({ ownerId: saved.id, terms: { ...terms, allowedTiers: terms.allowedTiers ?? seed.defaultAllowedTiers }, effectiveFrom, author }, tx);
    }
  }

  /** Saves each top-up pack, and its version when the file gives one. */
  private async seedTopUpPacks(seed: OfferSeedDto, author: ChangeAuthor, tx: DbTransaction): Promise<void> {
    for (const { version, ...fields } of seed.topUpPacks) {
      const saved = await this.catalog.saveTopUpPack(fields, author, tx);
      if (!version) continue;
      const { effectiveFrom, ...terms } = version;
      await this.catalog.saveTopUpPackVersion({ ownerId: saved.id, terms, effectiveFrom, author }, tx);
    }
  }

  /** Saves each Enterprise bundle, and its version when the file gives one. */
  private async seedEnterpriseBundles(seed: OfferSeedDto, author: ChangeAuthor, tx: DbTransaction): Promise<void> {
    for (const { version, ...fields } of seed.enterpriseBundles) {
      const saved = await this.catalog.saveEnterpriseBundle(fields, author, tx);
      if (!version) continue;
      const { effectiveFrom, ...terms } = version;
      await this.catalog.saveEnterpriseBundleVersion({ ownerId: saved.id, terms, effectiveFrom, author }, tx);
    }
  }
}
