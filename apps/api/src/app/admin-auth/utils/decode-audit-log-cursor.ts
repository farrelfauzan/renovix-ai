import type { AuditLogCursor } from "../types/audit-log-cursor";

/** created_at as `encodeAuditLogCursor` writes it: UTC with microseconds. */
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
/** An audit row id (a UUID; any short id-like text is accepted, it is only compared). */
const CURSOR_ID = /^[A-Za-z0-9-]{1,64}$/;

const isCursorPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string";

/** Reads a `cursor` query value (RX-164); null when it is not one `encodeAuditLogCursor` could have written. */
export function decodeAuditLogCursor(value: string): AuditLogCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isCursorPair(parsed) || !CURSOR_TIME.test(parsed[0]) || !CURSOR_ID.test(parsed[1])) return null;
    if (Number.isNaN(Date.parse(parsed[0]))) return null;
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    return null;
  }
}
