import { Injectable, NotFoundException } from "@nestjs/common";
import type { TopUpPack, TopUpPackVersion } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TopUpPackRepository } from "../../offers/repository/top-up-pack.repository";
import { OfferCatalogService } from "../../offers/service/offer-catalog.service";
import type { TopUpPackVersionBodyDto } from "../dto/top-up-pack-version-body.dto";
import type { UpdateActiveBodyDto } from "../dto/update-active-body.dto";
import type { AdminWriteInput } from "../types/admin-write-input";
import type { Audited } from "../types/audited";
import { buildVersionAuditChange } from "../utils/build-version-audit-change";

const NOT_FOUND = "Top-up pack not found";

/**
 * Top-up packs through the admin API (RNX-226). Writes go through OfferCatalogService on the route's audit transaction,
 * so the pack or version, its catalog change record and the audit row commit together. Purchase snapshots are never touched.
 */
@Injectable()
export class AdminTopUpPacksService {
  constructor(
    private readonly packs: TopUpPackRepository,
    private readonly catalog: OfferCatalogService,
  ) {}

  /** Every top-up pack by name, each with all its versions, newest first. */
  list() {
    return this.packs.findAllWithVersions();
  }

  /** One top-up pack with all its versions; 404 when it does not exist. */
  async get(id: string, tx?: DbTransaction) {
    const found = await this.packs.findByIdWithVersions(id, tx);
    if (!found) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  /** Turns the pack's active flag on or off (no new version: it is not a term). */
  async update(input: AdminWriteInput<UpdateActiveBodyDto>, tx: DbTransaction): Promise<Audited<TopUpPack>> {
    const { reason, active } = input.body;
    const before = await this.get(input.id, tx);
    const saved = await this.catalog.saveTopUpPack({ name: before.name, active }, { changedBy: input.adminId, reason }, tx);
    return { result: saved, change: { before: { packId: before.id, active: before.active }, after: { packId: saved.id, active: saved.active }, reason } };
  }

  /** Creates the pack's next version with these terms, from `effectiveFrom`; unchanged terms create none. */
  async createVersion(input: AdminWriteInput<TopUpPackVersionBodyDto>, tx: DbTransaction): Promise<Audited<TopUpPackVersion>> {
    const { reason, effectiveFrom, ...terms } = input.body;
    await this.get(input.id, tx);
    const latest = await this.packs.findLatestVersion(input.id, tx);
    const author = { changedBy: input.adminId, reason };
    const saved = await this.catalog.saveTopUpPackVersion({ ownerId: input.id, terms, effectiveFrom: new Date(effectiveFrom), author }, tx);
    return { result: saved, change: buildVersionAuditChange({ subject: { packId: input.id }, latest, saved, terms, reason }) };
  }
}
