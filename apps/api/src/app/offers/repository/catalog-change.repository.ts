import { Injectable } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client.js";
import type { DbTransaction } from "../../prisma/db-transaction";

/** The queries on `catalog_changes` (RX-86). Change records are only ever inserted, in the transaction of the change. */
@Injectable()
export class CatalogChangeRepository {
  /** Inserts a change record. */
  create(data: Prisma.CatalogChangeCreateInput, tx: DbTransaction) {
    return tx.catalogChange.create({ data });
  }
}
