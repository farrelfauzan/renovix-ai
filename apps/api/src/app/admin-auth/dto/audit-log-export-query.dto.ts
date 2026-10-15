import { z } from "zod";
import { hasValidRange } from "../utils/has-valid-range";
import { AuditLogFiltersDto } from "./audit-log-filters.dto";

/** The query of the audit log CSV export (RX-164): the same filters as the read route, no cursor (every page). */
export const AuditLogExportQueryDto = AuditLogFiltersDto.refine(hasValidRange, { message: "from must be before to", path: ["from"] });
export type AuditLogExportQueryDto = z.infer<typeof AuditLogExportQueryDto>;
