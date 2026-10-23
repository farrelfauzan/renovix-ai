import type { UsageReportRow } from "./usage-report-row";

/** The answer of `GET /admin/usage/daily` (RNX-228). */
export type UsageReport = {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  readonly rows: readonly UsageReportRow[];
};
