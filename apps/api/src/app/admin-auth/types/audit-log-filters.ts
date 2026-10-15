/** The filters of the audit log screen and its CSV export (RX-164); every one is optional. */
export type AuditLogFilters = {
  /** Rows written by this admin (admin user id). */
  readonly adminId?: string;
  readonly resource?: string;
  readonly action?: string;
  /** Rows recorded at or after this time (created_at). */
  readonly from?: Date;
  /** Rows recorded before this time (created_at, exclusive). */
  readonly to?: Date;
};
