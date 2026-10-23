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

  /** True when the user has bought a package (Starter or Pro) through a checkout (RNX-35, D36, D37). */
  async hasPackagePurchase(userId: string, tx?: DbTransaction): Promise<boolean> {
    const found = await (tx ?? this.prisma).purchaseSnapshot.findFirst({ where: { buyerUserId: userId, packageVersionId: { not: null } }, select: { id: true } });
    return found !== null;
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
