import type { AuditLogRow } from "./audit-log-row";

/** One page of the audit log (RX-164): up to 50 rows newest first; `nextCursor` is null on the last page. */
export type AuditLogPage = {
  readonly rows: readonly AuditLogRow[];
  readonly nextCursor: string | null;
};
