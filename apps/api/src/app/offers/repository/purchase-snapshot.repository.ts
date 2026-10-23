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

  /** RNX-232: the allowed tiers of the buyer's newest package purchase (top-up packs carry none), if there is one. */
  findLatestPackageTiers(buyerUserId: string, tx?: DbTransaction) {
    return (tx ?? this.prisma).purchaseSnapshot.findFirst({
      where: { buyerUserId, packageVersionId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { allowedTiers: true },
    });
  }
}
