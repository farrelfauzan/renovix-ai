import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";
import type { VersionAuditInput } from "../types/version-audit-input";
import { listChangedFields } from "./list-changed-fields";

/**
 * The audit change of a new version (RNX-226): the owner and its latest version number before, the version that holds
 * the terms after with the names of the terms that changed (the values are on the catalog change record), the reason,
 * and when the version takes effect. Terms equal to the latest version's create no version: before and after name the same one.
 */
export function buildVersionAuditChange({ subject, latest, saved, terms, reason }: VersionAuditInput): AdminAuditChange {
  return {
    before: { ...subject, versionNumber: latest?.versionNumber ?? null },
    after: { ...subject, versionId: saved.id, versionNumber: saved.versionNumber, changedFields: listChangedFields(latest, terms) },
    reason,
    effectiveAt: saved.effectiveFrom,
  };
}
