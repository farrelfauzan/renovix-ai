import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PrismaService } from "../../prisma/prisma.service";

/** The queries on `purchase_snapshots` (RX-86). Snapshots are only ever inserted. */
@Injectable()
export class PurchaseSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts a purchase snapshot. */
  create(data: Prisma.PurchaseSnapshotUncheckedCreateInput, tx: DbTransaction) {
    return tx.purchaseSnapshot.create({ data });
  }

  /** True when the user has a package (Starter or Pro): bought through a checkout (RNX-35, D36, D37) or granted by a code (RNX-251). */
  async hasPackagePurchase(userId: string, tx?: DbTransaction): Promise<boolean> {
    const found = await (tx ?? this.prisma).purchaseSnapshot.findFirst({ where: { buyerUserId: userId, packageVersionId: { not: null } }, select: { id: true } });
    return found !== null;
  }

  /** All package snapshots aggregated independently of purchase order; top-ups are excluded. */
  findPackageSnapshots(buyerUserId: string, tx?: DbTransaction) {
    const db = tx ?? this.prisma;
    return db.$queryRaw<[{ snapshotId: string; packageVersionId: string; packageName: string; displayOrder: number; maxAgents: number | null; maxConnectedTools: number | null; apiAccess: boolean | null; collaborationEnabled: boolean | null; allowedChannels: string[] | null; allowedTiers: string[] | null }]>`
      WITH package_rows AS (
        SELECT * FROM purchase_snapshots
        WHERE buyer_user_id = ${buyerUserId} AND package_version_id IS NOT NULL
      ), aggregated AS (
          SELECT buyer_user_id, MAX(max_agents) AS "maxAgents", MAX(max_connected_tools) AS "maxConnectedTools",
          BOOL_OR(api_access) AS "apiAccess", BOOL_OR(collaboration_enabled) AS "collaborationEnabled",
          ARRAY(SELECT DISTINCT c FROM package_rows r CROSS JOIN LATERAL unnest(r.allowed_channels) c ORDER BY c) AS "allowedChannels",
          ARRAY(SELECT DISTINCT t FROM package_rows r CROSS JOIN LATERAL unnest(r.allowed_tiers) t ORDER BY t) AS "allowedTiers"
        FROM package_rows GROUP BY buyer_user_id
      )
      SELECT DISTINCT ON (ps.buyer_user_id)
        ps.id AS "snapshotId", ps.package_version_id AS "packageVersionId",
        p.name AS "packageName", p.display_order AS "displayOrder",
        a."maxAgents", a."maxConnectedTools", a."apiAccess", a."collaborationEnabled", a."allowedChannels", a."allowedTiers"
      FROM purchase_snapshots ps
      JOIN package_versions pv ON pv.id = ps.package_version_id
      JOIN packages p ON p.id = pv.package_id
      JOIN aggregated a ON a.buyer_user_id = ps.buyer_user_id
      WHERE ps.buyer_user_id = ${buyerUserId} AND ps.package_version_id IS NOT NULL
      ORDER BY ps.buyer_user_id, p.display_order DESC, ps.created_at DESC, ps.id ASC
    `;
  }
}
