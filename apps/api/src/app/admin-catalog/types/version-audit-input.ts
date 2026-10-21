import type { AdminAuditValues } from "../../admin-auth/types/admin-audit-values";

/** What `buildVersionAuditChange` records (RNX-226): the owner, its latest version before the write, the version that holds the terms after it, the terms given, and why. */
export type VersionAuditInput = {
  /** The owner's id, kept on both sides, e.g. `{ packageId }`. */
  readonly subject: AdminAuditValues;
  readonly latest: { readonly versionNumber: number } | null;
  readonly saved: { readonly id: string; readonly versionNumber: number; readonly effectiveFrom: Date };
  readonly terms: object;
  readonly reason: string;
};
