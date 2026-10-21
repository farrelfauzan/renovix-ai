import { Injectable, NotFoundException } from "@nestjs/common";
import type { EnterpriseBundle, EnterpriseBundleVersion } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { EnterpriseBundleRepository } from "../../offers/repository/enterprise-bundle.repository";
import { OfferCatalogService } from "../../offers/service/offer-catalog.service";
import type { EnterpriseBundleVersionBodyDto } from "../dto/enterprise-bundle-version-body.dto";
import type { UpdateActiveBodyDto } from "../dto/update-active-body.dto";
import type { AdminWriteInput } from "../types/admin-write-input";
import type { Audited } from "../types/audited";
import { buildVersionAuditChange } from "../utils/build-version-audit-change";

const NOT_FOUND = "Enterprise bundle not found";

/**
 * Enterprise bundles through the admin API (RNX-226). Writes go through OfferCatalogService on the route's audit
 * transaction, so the bundle or version, its catalog change record and the audit row commit together. A new version
 * never edits one a contract points to.
 */
@Injectable()
export class AdminEnterpriseBundlesService {
  constructor(
    private readonly bundles: EnterpriseBundleRepository,
    private readonly catalog: OfferCatalogService,
  ) {}

  /** Every Enterprise bundle by name, each with all its versions, newest first. */
  list() {
    return this.bundles.findAllWithVersions();
  }

  /** One Enterprise bundle with all its versions; 404 when it does not exist. */
  async get(id: string, tx?: DbTransaction) {
    const found = await this.bundles.findByIdWithVersions(id, tx);
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  /** Turns the bundle's active flag on or off (no new version: it is not a term). */
  async update(input: AdminWriteInput<UpdateActiveBodyDto>, tx: DbTransaction): Promise<Audited<EnterpriseBundle>> {
    const { reason, active } = input.body;
    const before = await this.get(input.id, tx);
    const saved = await this.catalog.saveEnterpriseBundle({ name: before.name, active }, { changedBy: input.adminId, reason }, tx);
    return { result: saved, change: { before: { bundleId: before.id, active: before.active }, after: { bundleId: saved.id, active: saved.active }, reason } };
  }

  /** Creates the bundle's next version with these amounts, from `effectiveFrom`; unchanged amounts create none. */
  async createVersion(input: AdminWriteInput<EnterpriseBundleVersionBodyDto>, tx: DbTransaction): Promise<Audited<EnterpriseBundleVersion>> {
    const { reason, effectiveFrom, ...terms } = input.body;
    await this.get(input.id, tx);
    const latest = await this.bundles.findLatestVersion(input.id, tx);
    const author = { changedBy: input.adminId, reason };
    const saved = await this.catalog.saveEnterpriseBundleVersion({ ownerId: input.id, terms, effectiveFrom: new Date(effectiveFrom), author }, tx);
    return { result: saved, change: buildVersionAuditChange({ subject: { bundleId: input.id }, latest, saved, terms, reason }) };
  }
}
