import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";
import type { AuditChangeInput } from "../types/audit-change-input";

/**
 * The audit change of an admin-providers write (RX-177): the subject's id and `changedFields` naming every
 * changed field, secret or not. No field value is recorded, old or new (D197).
 */
export function buildAuditChange({ subject, before, after, changedSecrets = [] }: AuditChangeInput): AdminAuditChange {
  const changed = Object.keys(after).filter((key) => before[key] !== after[key]);
  return {
    before: { ...subject },
    after: { ...subject, changedFields: [...changed, ...changedSecrets].join(",") },
  };
}
