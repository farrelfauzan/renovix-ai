import type { AdminAuditValues } from "../../admin-auth/types/admin-audit-values";

/** What `buildAuditChange` compares (RX-177): the row's ids, its non-secret values before and after, and the secret fields that changed. */
export type AuditChangeInput = {
  /** Ids that name the row, kept on both sides, e.g. `{ providerId }`. */
  readonly subject: AdminAuditValues;
  readonly before: AdminAuditValues;
  readonly after: AdminAuditValues;
  /** Secret fields that changed, named in `changedFields` without a value, e.g. ["apiKey"]. */
  readonly changedSecrets?: readonly string[];
};
