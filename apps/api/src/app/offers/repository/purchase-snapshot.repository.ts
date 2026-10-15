import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";

/** The queries on `purchase_snapshots` (RX-86). Snapshots are only ever inserted. */
@Injectable()
export class PurchaseSnapshotRepository {
  /** Inserts a purchase snapshot. */
  create(data: Prisma.PurchaseSnapshotUncheckedCreateInput, tx: DbTransaction) {
    return tx.purchaseSnapshot.create({ data });
  }
}
