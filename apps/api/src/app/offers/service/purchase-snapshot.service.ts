import { Injectable, NotFoundException } from "@nestjs/common";
import type { PurchaseSnapshot } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { PackageRepository } from "../repository/package.repository";
import { PurchaseSnapshotRepository } from "../repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "../repository/top-up-pack.repository";
import type { PurchaseInput } from "../types/purchase-input";

/**
 * Purchase snapshots (RX-86, D37): what a buyer bought, copied from the version in the same transaction, so
 * it stays correct whatever later versions say. Snapshots are append-only in the database. No checkout
 * calls it yet (RX-35).
 */
@Injectable()
export class PurchaseSnapshotService {
  constructor(
    private readonly packages: PackageRepository,
    private readonly packs: TopUpPackRepository,
    private readonly snapshots: PurchaseSnapshotRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Records the purchase of a package version: its price, credits and limits as they are now. 404 for an unknown version. */
  async recordPackagePurchase(input: PurchaseInput, tx?: DbTransaction): Promise<PurchaseSnapshot> {
    return this.transactions.run(async (db) => {
      const version = await this.packages.findVersionById(input.versionId, db);
      if (!version) throw new NotFoundException("Package version not found");
      const { priceRupiah, creditsGranted, billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers } = version;
      const copied = { priceRupiah, creditsGranted, billing, maxAgents, maxConnectedTools, apiAccess, allowedChannels, allowedTiers };
      return this.snapshots.create({ ...copied, buyerUserId: input.buyerUserId, packageVersionId: version.id, paymentId: input.paymentId }, db);
    }, undefined, tx);
  }

  /** Records the purchase of a top-up pack version: its price and credits as they are now. 404 for an unknown version. */
  async recordTopUpPurchase(input: PurchaseInput, tx?: DbTransaction): Promise<PurchaseSnapshot> {
    return this.transactions.run(async (db) => {
      const version = await this.packs.findVersionById(input.versionId, db);
      if (!version) throw new NotFoundException("Top-up pack version not found");
      const copied = { priceRupiah: version.priceRupiah, creditsGranted: version.creditsGranted, allowedChannels: [], allowedTiers: [] };
      return this.snapshots.create({ ...copied, buyerUserId: input.buyerUserId, topUpPackVersionId: version.id, paymentId: input.paymentId }, db);
    }, undefined, tx);
  }
}
