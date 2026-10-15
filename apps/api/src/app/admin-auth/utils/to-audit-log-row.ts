import type { AuditLogRecord } from "../types/audit-log-record";
import type { AuditLogRow } from "../types/audit-log-row";
import { maskPersonalData } from "./mask-personal-data";

/** A row of the audit log screen (RX-164): before, after and reason masked unless `showPii` (`users:read_pii`). */
export function toAuditLogRow(record: AuditLogRecord, showPii: boolean): AuditLogRow {
  const show = (value: unknown): unknown => (showPii ? value : maskPersonalData(value));
  return {
    id: record.id,
    adminId: record.adminId,
    adminEmail: record.adminEmail,
    resource: record.resource,
    action: record.action,
    before: show(record.before),
    after: show(record.after),
    reason: String(show(record.reason)),
    effectiveAt: record.effectiveAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}
