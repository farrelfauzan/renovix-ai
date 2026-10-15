import type { AdminAuditChange } from "../types/admin-audit-change";

/** The audit change of ending a back-office session (RX-97): the session id and its revoked flag, nothing secret. */
export const buildSessionRevokedChange = (sessionId: string): AdminAuditChange => ({
  before: { sessionId, revoked: false },
  after: { sessionId, revoked: true },
});
