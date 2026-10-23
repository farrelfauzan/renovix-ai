import type { ReconcileOutcome } from "./reconcile-outcome";

/** One reconciliation run (RNX-35): whether payments were off (nothing checked), and the outcome of each claimed order, counted. */
export type ReconcileSummary = {
  readonly isPaused: boolean;
  readonly claimed: number;
  readonly outcomes: Partial<Record<ReconcileOutcome, number>>;
};
