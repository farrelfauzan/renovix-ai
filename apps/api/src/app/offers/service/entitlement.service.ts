import { BadRequestException, Injectable } from "@nestjs/common";
import { PurchaseSnapshotRepository } from "../repository/purchase-snapshot.repository";
import { PackageRepository } from "../repository/package.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import { normalizeEntitlementSnapshot } from "../utils/normalize-entitlement-snapshot";

/**
 * Snapshot-backed package entitlements (RNX-76). Top-ups are excluded by the repository query.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly snapshots: PurchaseSnapshotRepository,
    private readonly packages: PackageRepository,
  ) {}

  async getForUser(userId: string, tx?: DbTransaction) {
    const [snapshot] = await this.snapshots.findPackageSnapshots(userId, tx);
    if (!snapshot) return null;
    return {
      snapshotId: snapshot.snapshotId,
      packageVersionId: snapshot.packageVersionId,
      packageName: snapshot.packageName,
      displayOrder: snapshot.displayOrder,
      ...normalizeEntitlementSnapshot(snapshot),
    };
  }

  async requireLimit(userId: string, limit: "maxAgents" | "maxConnectedTools", current: number, tx?: DbTransaction) {
    const entitlement = await this.getForUser(userId, tx);
    if (entitlement && current < entitlement[limit]) return entitlement;
    const threshold = Math.max(current, entitlement?.[limit] ?? 0);
    const next = (await this.packages.findNextListedAfter(entitlement?.displayOrder ?? null, limit, threshold, new Date(), tx))[0];
    throw new BadRequestException({ error: { type: "PACKAGE_LIMIT_REACHED", used: current, limit: entitlement?.[limit] ?? 0, nextPackage: next?.name ?? null } });
  }
}
