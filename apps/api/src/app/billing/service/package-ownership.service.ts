import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PurchaseSnapshotRepository } from "../../offers/repository/purchase-snapshot.repository";

/**
 * Whether an account has a package (D36, docs/credits.md section 6): a purchase snapshot of a package version (D37:
 * permanent), bought through a checkout or granted by an invitation code (RNX-251: paymentId null). A free account has
 * none: it may not buy a top-up pack or redeem a credits-only code.
 */
@Injectable()
export class PackageOwnershipService {
  constructor(private readonly snapshots: PurchaseSnapshotRepository) {}

  /** True when the user has a package snapshot (bought or granted by a code). */
  async hasPackage(userId: string, tx?: DbTransaction): Promise<boolean> {
    return this.snapshots.hasPackagePurchase(userId, tx);
  }
}
