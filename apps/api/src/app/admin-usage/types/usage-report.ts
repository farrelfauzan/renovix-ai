import type { ReportPeriod } from "./report-period";
import type { UsageReportRow } from "./usage-report-row";

/** GET /admin/usage/daily (RNX-228): token counts and calls of the period. */
export type UsageReport = ReportPeriod & { readonly rows: UsageReportRow[] };
