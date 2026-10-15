import { z } from "zod";
import { decodeAuditLogCursor } from "../utils/decode-audit-log-cursor";
import { hasValidRange } from "../utils/has-valid-range";
import { AuditLogFiltersDto } from "./audit-log-filters.dto";

/** Longest cursor accepted (one the API writes is about 110 characters). */
const MAX_CURSOR_LENGTH = 512;

/** The `cursor` of the next page, as the previous page returned it; anything else is refused. */
const cursor = z.string().max(MAX_CURSOR_LENGTH).transform((value, ctx) => {
  const decoded = decodeAuditLogCursor(value);
  if (!decoded) ctx.addIssue({ code: "custom", message: "invalid cursor" });
  return decoded ?? z.NEVER;
});

/** The query of the audit log read route (RX-164): the filters and the optional page cursor. */
export const AuditLogQueryDto = AuditLogFiltersDto.extend({ cursor: cursor.optional() }).refine(hasValidRange, {
  message: "from must be before to",
  path: ["from"],
});
export type AuditLogQueryDto = z.infer<typeof AuditLogQueryDto>;
