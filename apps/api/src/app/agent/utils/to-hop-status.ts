import { ProviderAttemptDeadlineError } from "../../providers/errors/provider-attempt-deadline-error";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import { RunLimitStoppedError } from "../errors/run-limit-stopped.error";
import type { ChildRunStatus } from "../types/child-run-status";

/**
 * RNX-121b-1: how a hop that failed ended: at the run's budget, past its model call's deadline or (RNX-326) the run's
 * time limit, or with any other error (an abort included, and the run's model-call cap).
 */
export function toHopStatus(err: unknown): Exclude<ChildRunStatus, "completed" | "refused"> {
  if (err instanceof RunBudgetStoppedError) return "budget_stopped";
  if (err instanceof ProviderAttemptDeadlineError) return "timeout";
  if (err instanceof RunLimitStoppedError && err.limit === "run_time") return "timeout";
  return "error";
}
