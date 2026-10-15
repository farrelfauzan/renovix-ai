/** The filters of the audit log screen as the form holds them (RX-164); "" means not set. */
export type AuditLogFilters = {
  readonly adminId: string;
  readonly resource: string;
  readonly action: string;
  /** A `datetime-local` value in the browser's time zone, e.g. "2026-10-15T08:00". */
  readonly from: string;
  readonly to: string;
};
