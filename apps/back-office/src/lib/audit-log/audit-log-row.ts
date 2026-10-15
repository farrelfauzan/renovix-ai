/** One row of `GET /api/v1/admin/audit-log` (RX-164); personal data already masked by the API unless the admin holds `users:read_pii`. */
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
  /** ISO time. */
  readonly createdAt: string;
};
