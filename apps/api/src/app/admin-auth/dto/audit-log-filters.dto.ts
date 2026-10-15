import { z } from "zod";

/** Longest admin id, resource or action filter accepted. */
const MAX_FILTER_LENGTH = 100;

const text = z.string().trim().min(1).max(MAX_FILTER_LENGTH).optional();
const time = z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional();

/**
 * The filters of the audit log read and its CSV export (RX-164), from the query string: admin id,
 * resource, action (exact match), and a time range on created_at (`from` inclusive, `to` exclusive,
 * ISO 8601 with a time zone). Unknown parameters and repeated ones are refused (400).
 */
export const AuditLogFiltersDto = z.strictObject({ adminId: text, resource: text, action: text, from: time, to: time });

