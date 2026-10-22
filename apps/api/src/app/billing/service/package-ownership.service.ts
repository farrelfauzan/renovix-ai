import { Injectable } from "@nestjs/common";
import type { DbTransaction } from "../../prisma/db-transaction";
import { PurchaseSnapshotRepository } from "../../offers/repository/purchase-snapshot.repository";
import { UserSubscriptionRepository } from "../repository/user-subscription.repository";

/**
 * Whether an account has a package (D36, docs/credits.md section 6): an active subscription (a code that grants a
 * plan) or a bought package (a purchase snapshot of a package version, D37: permanent). A free account has neither:
 * it may not buy a top-up pack or redeem a credits-only code.
 */
@Injectable()
export class PackageOwnershipService {
  constructor(
    private readonly subscriptions: UserSubscriptionRepository,
    private readonly snapshots: PurchaseSnapshotRepository,
  ) {}

  /** True when the user has an active subscription or a bought package. */
  async hasPackage(userId: string, tx?: DbTransaction): Promise<boolean> {
    const subscription = await this.subscriptions.findSubscriptionByUserId(userId, tx);
    if (subscription?.status === "active") return true;
    return this.snapshots.hasPackagePurchase(userId, tx);
  }
}
