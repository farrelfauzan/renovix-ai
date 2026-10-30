import { Injectable } from "@nestjs/common";
import { PurchaseSnapshotRepository } from "../repository/purchase-snapshot.repository";
import { PackageRepository } from "../repository/package.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import type { Entitlement } from "../types/entitlement";
import type { PackageGrant } from "../types/package-grant";
import { createPackageLimitReachedException } from "../utils/create-package-limit-reached-exception";
import { normalizeEntitlementSnapshot } from "../utils/normalize-entitlement-snapshot";
import { toAllowedTiers } from "../utils/to-allowed-tiers";

/**
 * Snapshot-backed package entitlements (RNX-76). Top-ups are excluded by the repository query. Every refusal is a
 * 400 PACKAGE_LIMIT_REACHED naming the feature and the next listed package that grants it.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly snapshots: PurchaseSnapshotRepository,
    private readonly packages: PackageRepository,
  ) {}

  async getForUser(userId: string, tx?: DbTransaction): Promise<Entitlement | null> {
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
    throw createPackageLimitReachedException({ feature: limit, used: current, limit: entitlement?.[limit] ?? 0, nextPackage: next?.name ?? null });
  }

  /** RNX-76 B2 (Q2): the account's entitlement when one of its packages grants API access; a free account has none. */
  async requireApiAccess(userId: string, tx?: DbTransaction): Promise<Entitlement> {
    const entitlement = await this.getForUser(userId, tx);
    if (entitlement?.apiAccess) return entitlement;
    throw createPackageLimitReachedException({ feature: "apiAccess", nextPackage: await this.findNextGranting(entitlement, { feature: "apiAccess" }, tx) });
  }

  /**
   * RNX-76 B2: the tiers `entitlement` allows (its packages' tiers plus the cheapest tier, Q1), refused when one of
   * `requested` is not among them.
   */
  async requireTiers(entitlement: Entitlement | null, requested: readonly string[], tx?: DbTransaction): Promise<string[]> {
    const allowed = toAllowedTiers(entitlement?.allowedTiers ?? []);
    if (requested.every((tier) => allowed.includes(tier))) return allowed;
    const nextPackage = await this.findNextGranting(entitlement, { feature: "tier", requested }, tx);
    throw createPackageLimitReachedException({ feature: "tier", requested, nextPackage });
  }

  private async findNextGranting(entitlement: Entitlement | null, grant: PackageGrant, tx?: DbTransaction): Promise<string | null> {
    const [next] = await this.packages.findNextListedGranting(entitlement?.displayOrder ?? null, grant, new Date(), tx);
    return next?.name ?? null;
  }
}
