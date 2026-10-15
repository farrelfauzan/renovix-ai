import type { AuditLogRow } from "../types/audit-log-row";

/** The CSV cells of one audit log row (RX-164), in the order of the export's header; before and after as JSON. */
export const toAuditLogCsvCells = (row: AuditLogRow): string[] => [
  row.id, row.createdAt, row.adminId, row.adminEmail, row.resource, row.action,
  JSON.stringify(row.before), JSON.stringify(row.after), row.reason, row.effectiveAt,
];
