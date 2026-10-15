/**
 * Where a page of the audit log ends (RX-164): the last row's created_at and id. Keyset paging over
 * (created_at DESC, id DESC). `createdAt` keeps the database's microseconds as UTC text
 * ("2026-10-15T08:00:01.123456Z"): a JavaScript Date keeps milliseconds only, and a cursor cut to
 * milliseconds would skip rows recorded in the same millisecond.
 */
export type AuditLogCursor = {
  readonly createdAt: string;
  readonly id: string;
};
