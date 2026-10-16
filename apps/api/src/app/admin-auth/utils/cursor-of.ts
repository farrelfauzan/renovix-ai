import type { AuditLogCursor } from "../types/audit-log-cursor";
import type { AuditLogRecord } from "../types/audit-log-record";

export const cursorOf = (record: AuditLogRecord): AuditLogCursor => ({ createdAt: record.cursorAt, id: record.id });
