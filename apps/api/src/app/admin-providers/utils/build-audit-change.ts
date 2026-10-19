import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";
import type { AuditChangeInput } from "../types/audit-change-input";

/**
 * The audit change of an admin-providers write (RX-177): only the fields that changed, with their old and
 * new non-secret values, and `changedFields` naming every changed field; a secret field (the key) is named
 * there and nowhere else, never with a value.
 */
export function buildAuditChange({ subject, before, after, changedSecrets = [] }: AuditChangeInput): AdminAuditChange {
  const changed = Object.keys(after).filter((key) => before[key] !== after[key]);
  const valuesBefore = Object.fromEntries(changed.filter((key) => key in before).map((key) => [key, before[key]]));
  const valuesAfter = Object.fromEntries(changed.map((key) => [key, after[key]]));
  return {
    before: { ...subject, ...valuesBefore },
    after: { ...subject, ...valuesAfter, changedFields: [...changed, ...changedSecrets].join(",") },
  };
}
