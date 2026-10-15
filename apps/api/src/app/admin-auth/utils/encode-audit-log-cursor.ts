import type { AuditLogCursor } from "../types/audit-log-cursor";

/** The opaque `cursor` query value of the next audit log page (RX-164): base64url of `[createdAt, id]`. */
export const encodeAuditLogCursor = (cursor: AuditLogCursor): string =>
  Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString("base64url");
