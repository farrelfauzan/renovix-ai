import type { ReconciliationRow } from "./reconciliation-row";

/** The answer of `GET /admin/reconciliation` (RNX-228). */
export type ReconciliationReport = {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
  /** The drift threshold setting; null while it has no value (nothing is flagged). */
  readonly driftThresholdPercent: number | null;
  readonly rows: readonly ReconciliationRow[];
};
