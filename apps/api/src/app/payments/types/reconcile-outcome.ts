import type { CheckOutcome } from "./check-outcome";

/** One reconciled order's result (RNX-35): what its status check did, or "error" when the check threw. */
export type ReconcileOutcome = CheckOutcome | "error";
