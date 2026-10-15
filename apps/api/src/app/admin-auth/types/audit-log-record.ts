/** One audit row as the audit log read returns it from the database (RX-164), unmasked. */
export type AuditLogRecord = {
  readonly id: string;
  readonly adminId: string;
  readonly adminEmail: string;
  readonly resource: string;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly effectiveAt: Date;
  readonly createdAt: Date;
  /** created_at with microseconds, UTC text: the keyset cursor's position (see AuditLogCursor). */
  readonly cursorAt: string;
};
