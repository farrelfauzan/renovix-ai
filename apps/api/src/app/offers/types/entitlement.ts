import type { normalizeEntitlementSnapshot } from "../utils/normalize-entitlement-snapshot";

/** An account's package entitlement aggregated over all its package snapshots (RNX-76), with the package shown. */
export type Entitlement = ReturnType<typeof normalizeEntitlementSnapshot> & {
  readonly snapshotId: string;
  readonly packageVersionId: string;
  readonly packageName: string;
  readonly displayOrder: number;
};
