import type { ReconciliationRow } from "./reconciliation-row";
import type { ReportPeriod } from "./report-period";

/** GET /admin/reconciliation (RNX-228): the entered days of the period, each against our estimate. */
export type ReconciliationReport = ReportPeriod & {
  /** The reconciliationDriftThresholdPercent setting; null while it has no value (nothing is flagged). */
  readonly driftThresholdPercent: number | null;
  readonly rows: ReconciliationRow[];
};
