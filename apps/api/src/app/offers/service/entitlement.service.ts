import { Injectable } from "@nestjs/common";
import { MODEL_TIERS } from "../config/model-tiers";
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
   * `requested` is not among them; the hint names a package granting the missing tiers only.
   */
  async requireTiers(entitlement: Entitlement | null, requested: readonly string[], tx?: DbTransaction): Promise<string[]> {
    const allowed = toAllowedTiers(entitlement?.allowedTiers ?? []);
    const missing = requested.filter((tier) => !allowed.includes(tier));
    if (missing.length === 0) return allowed;
    const nextPackage = await this.findNextGranting(entitlement, { feature: "tier", requested: missing }, tx);
    throw createPackageLimitReachedException({ feature: "tier", requested, nextPackage });
  }

  /**
   * RNX-76 B2b (Q6): refuses a model of `tier` this user's packages do not allow. The cheapest tier, which every
   * account keeps (Q1), is allowed without reading the packages.
   */
  async requireModelTier(userId: string, tier: string): Promise<void> {
    if (tier === MODEL_TIERS[0]) return;
    await this.requireTiers(await this.getForUser(userId), [tier]);
  }

  /** RNX-76 B2b: the account's entitlement when one of its packages grants `channelType`; a free account has none. */
  async requireChannel(userId: string, channelType: string): Promise<Entitlement> {
    const entitlement = await this.getForUser(userId);
    if (entitlement?.allowedChannels.includes(channelType)) return entitlement;
    const requested = [channelType];
    const nextPackage = await this.findNextGranting(entitlement, { feature: "channel", requested });
    throw createPackageLimitReachedException({ feature: "channel", requested, nextPackage });
  }

  private async findNextGranting(entitlement: Entitlement | null, grant: PackageGrant, tx?: DbTransaction): Promise<string | null> {
    const [next] = await this.packages.findNextListedGranting(entitlement?.displayOrder ?? null, grant, new Date(), tx);
    return next?.name ?? null;
  }
}
