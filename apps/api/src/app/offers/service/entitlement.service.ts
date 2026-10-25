import { Injectable } from "@nestjs/common";
import { PurchaseSnapshotRepository } from "../repository/purchase-snapshot.repository";

/**
 * Snapshot-backed package entitlements (RNX-76 PR-A). This service is deliberately not wired into a production
 * gate in PR-A: PR-B migrates every gate together. It is the single read model PR-B will use, and it never derives
 * collaboration rights from the mutable Package.name.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly snapshots: PurchaseSnapshotRepository) {}

  async getForUser(userId: string) {
    const snapshot = await this.snapshots.findLatestPackageSnapshot(userId);
    if (!snapshot || !snapshot.packageVersion) return null;
    return {
      snapshotId: snapshot.id,
      packageVersionId: snapshot.packageVersionId,
      packageName: snapshot.packageVersion.package.name,
      displayOrder: snapshot.packageVersion.package.displayOrder,
      maxAgents: snapshot.maxAgents,
      maxConnectedTools: snapshot.maxConnectedTools,
      apiAccess: snapshot.apiAccess,
      allowedChannels: snapshot.allowedChannels,
      allowedTiers: snapshot.allowedTiers,
      collaborationEnabled: snapshot.collaborationEnabled ?? false,
    };
  }
}
