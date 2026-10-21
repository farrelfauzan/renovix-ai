import { Injectable, NotFoundException } from "@nestjs/common";
import type { Package, PackageVersion } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PackageRepository } from "../../offers/repository/package.repository";
import { OfferCatalogService } from "../../offers/service/offer-catalog.service";
import type { PackageVersionBodyDto } from "../dto/package-version-body.dto";
import type { UpdatePackageBodyDto } from "../dto/update-package-body.dto";
import type { AdminWriteInput } from "../types/admin-write-input";
import type { Audited } from "../types/audited";
import { buildVersionAuditChange } from "../utils/build-version-audit-change";

const NOT_FOUND = "Package not found";

/**
 * Packages (Starter, Pro, Enterprise, D46) through the admin API (RNX-226). Writes go through OfferCatalogService on the
 * route's audit transaction, so the package or version, its catalog change record and the audit row commit together.
 * A new version never edits an earlier one, and purchase snapshots are never touched (D37).
 */
@Injectable()
export class AdminPackagesService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly catalog: OfferCatalogService,
  ) {}

  /** Every package in display order, each with all its versions, newest first. */
  list() {
    return this.packages.findAllWithVersions();
  }

  /** One package with all its versions; 404 when it does not exist. */
  async get(id: string, tx?: DbTransaction) {
    const found = await this.packages.findByIdWithVersions(id, tx);
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  /** Changes the package's display order or flags (no new version: they are not terms). */
  async update(input: AdminWriteInput<UpdatePackageBodyDto>, tx: DbTransaction): Promise<Audited<Package>> {
    const { reason, ...changes } = input.body;
    const before = await this.get(input.id, tx);
    const fields = { name: before.name, displayOrder: before.displayOrder, active: before.active, visible: before.visible };
    const saved = await this.catalog.savePackage({ ...fields, ...changes }, { changedBy: input.adminId, reason }, tx);
    const audited = (row: Package) => ({ packageId: row.id, displayOrder: row.displayOrder, active: row.active, visible: row.visible });
    return { result: saved, change: { before: audited(before), after: audited(saved), reason } };
  }

  /** Creates the package's next version with these terms, from `effectiveFrom`; unchanged terms create none. */
  async createVersion(input: AdminWriteInput<PackageVersionBodyDto>, tx: DbTransaction): Promise<Audited<PackageVersion>> {
    const { reason, effectiveFrom, ...terms } = input.body;
    await this.get(input.id, tx);
    const latest = await this.packages.findLatestVersion(input.id, tx);
    const author = { changedBy: input.adminId, reason };
    const saved = await this.catalog.savePackageVersion({ ownerId: input.id, terms, effectiveFrom: new Date(effectiveFrom), author }, tx);
    return { result: saved, change: buildVersionAuditChange({ subject: { packageId: input.id }, latest, saved, terms, reason }) };
  }
}
