import { Injectable } from "@nestjs/common";
import type { EnterpriseBundle, EnterpriseBundleVersion, Package, PackageVersion, TopUpPack, TopUpPackVersion } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { EnterpriseBundleVersionTermsDto } from "../dto/enterprise-bundle-version-terms.dto";
import { EnterpriseBundleDto } from "../dto/enterprise-bundle.dto";
import { PackageVersionTermsDto } from "../dto/package-version-terms.dto";
import { PackageDto } from "../dto/package.dto";
import { TopUpPackVersionTermsDto } from "../dto/top-up-pack-version-terms.dto";
import { TopUpPackDto } from "../dto/top-up-pack.dto";
import { CatalogChangeRepository } from "../repository/catalog-change.repository";
import { EnterpriseBundleRepository } from "../repository/enterprise-bundle.repository";
import { PackageRepository } from "../repository/package.repository";
import { TopUpPackRepository } from "../repository/top-up-pack.repository";
import type { ChangeAuthor } from "../types/change-author";
import type { VersionInput } from "../types/version-input";
import { buildCatalogChange } from "../utils/build-catalog-change";
import { buildNextVersionColumns } from "../utils/build-next-version-columns";
import { hasSameValues } from "../utils/has-same-values";
import { parseOrRefuse } from "../utils/parse-or-refuse";

/**
 * The offer catalog (RX-86, D46): packages, top-up packs and Enterprise bundles, and their versions. Every
 * write is validated with Zod and writes its change record in the same transaction; a save that changes
 * nothing writes nothing. A version is never edited: new terms create the next version (D37), and the
 * database refuses UPDATE and DELETE on version rows. No route yet: the seed script calls it, RX-98 will.
 */
@Injectable()
export class OfferCatalogService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly packs: TopUpPackRepository,
    private readonly bundles: EnterpriseBundleRepository,
    private readonly changes: CatalogChangeRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Creates the package named in `input`, or updates its order and flags. Returns the package as saved. */
  async savePackage(input: PackageDto, author: ChangeAuthor, tx?: DbTransaction): Promise<Package> {
    const fields = parseOrRefuse(PackageDto, input, "Package");
    return this.transactions.run(async (db) => {
      const before = await this.packages.findByName(fields.name, db);
      if (before && hasSameValues(before, fields)) return before;
      const after = before ? await this.packages.update(before.id, fields, db) : await this.packages.create(fields, db);
      await this.changes.create(buildCatalogChange({ entity: "package", entityId: after.id, before, after, author }), db);
      return after;
    }, undefined, tx);
  }

  /** Creates the package's next version, unless its latest version has the same terms. Returns the version that holds them. */
  async savePackageVersion(input: VersionInput<PackageVersionTermsDto>, tx?: DbTransaction): Promise<PackageVersion> {
    const terms = parseOrRefuse(PackageVersionTermsDto, input.terms, "Package version");
    return this.transactions.run(async (db) => {
      const before = await this.packages.findLatestVersion(input.ownerId, db);
      if (before && hasSameValues(before, terms)) return before;
      const after = await this.packages.createVersion({ ...terms, collaborationEnabled: terms.collaborationEnabled ?? false, packageId: input.ownerId, ...buildNextVersionColumns(before, input) }, db);
      await this.changes.create(buildCatalogChange({ entity: "package_version", entityId: after.id, before, after, author: input.author, effectiveFrom: after.effectiveFrom }), db);
      return after;
    }, undefined, tx);
  }

  /** Creates the top-up pack named in `input`, or updates its flag. Returns the pack as saved. */
  async saveTopUpPack(input: TopUpPackDto, author: ChangeAuthor, tx?: DbTransaction): Promise<TopUpPack> {
    const fields = parseOrRefuse(TopUpPackDto, input, "Top-up pack");
    return this.transactions.run(async (db) => {
      const before = await this.packs.findByName(fields.name, db);
      if (before && hasSameValues(before, fields)) return before;
      const after = before ? await this.packs.update(before.id, fields, db) : await this.packs.create(fields, db);
      await this.changes.create(buildCatalogChange({ entity: "top_up_pack", entityId: after.id, before, after, author }), db);
      return after;
    }, undefined, tx);
  }

  /** Creates the pack's next version, unless its latest version has the same terms. Returns the version that holds them. */
  async saveTopUpPackVersion(input: VersionInput<TopUpPackVersionTermsDto>, tx?: DbTransaction): Promise<TopUpPackVersion> {
    const terms = parseOrRefuse(TopUpPackVersionTermsDto, input.terms, "Top-up pack version");
    return this.transactions.run(async (db) => {
      const before = await this.packs.findLatestVersion(input.ownerId, db);
      if (before && hasSameValues(before, terms)) return before;
      const after = await this.packs.createVersion({ ...terms, packId: input.ownerId, ...buildNextVersionColumns(before, input) }, db);
      await this.changes.create(buildCatalogChange({ entity: "top_up_pack_version", entityId: after.id, before, after, author: input.author, effectiveFrom: after.effectiveFrom }), db);
      return after;
    }, undefined, tx);
  }

  /** Creates the Enterprise bundle named in `input`, or updates its flag. Returns the bundle as saved. */
  async saveEnterpriseBundle(input: EnterpriseBundleDto, author: ChangeAuthor, tx?: DbTransaction): Promise<EnterpriseBundle> {
    const fields = parseOrRefuse(EnterpriseBundleDto, input, "Enterprise bundle");
    return this.transactions.run(async (db) => {
      const before = await this.bundles.findByName(fields.name, db);
      if (before && hasSameValues(before, fields)) return before;
      const after = before ? await this.bundles.update(before.id, fields, db) : await this.bundles.create(fields, db);
      await this.changes.create(buildCatalogChange({ entity: "enterprise_bundle", entityId: after.id, before, after, author }), db);
      return after;
    }, undefined, tx);
  }

  /** Creates the bundle's next version, unless its latest version has the same amounts. Returns the version that holds them. */
  async saveEnterpriseBundleVersion(input: VersionInput<EnterpriseBundleVersionTermsDto>, tx?: DbTransaction): Promise<EnterpriseBundleVersion> {
    const terms = parseOrRefuse(EnterpriseBundleVersionTermsDto, input.terms, "Enterprise bundle version");
    return this.transactions.run(async (db) => {
      const before = await this.bundles.findLatestVersion(input.ownerId, db);
      if (before && hasSameValues(before, terms)) return before;
      const after = await this.bundles.createVersion({ ...terms, bundleId: input.ownerId, ...buildNextVersionColumns(before, input) }, db);
      await this.changes.create(buildCatalogChange({ entity: "enterprise_bundle_version", entityId: after.id, before, after, author: input.author, effectiveFrom: after.effectiveFrom }), db);
      return after;
    }, undefined, tx);
  }
}
