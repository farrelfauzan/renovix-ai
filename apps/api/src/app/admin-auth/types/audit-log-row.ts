/** One row of the audit log screen (RX-164): personal data in before, after and reason masked unless `users:read_pii`. */
export type AuditLogRow = {
  readonly id: string;
  readonly adminId: string;
  readonly adminEmail: string;
  readonly resource: string;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  /** ISO time. */
  readonly effectiveAt: string;
  /** ISO time the row was recorded; the list is newest first by it. */
  readonly createdAt: string;
};
