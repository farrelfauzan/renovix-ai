import type { AdminAuditChange } from "./admin-audit-change";

/** A CSV export ready to stream (RX-164): the change its audit row records, and the CSV text, batch by batch. */
export type AuditLogExport = {
  readonly change: AdminAuditChange;
  readonly csv: AsyncIterable<string>;
};
