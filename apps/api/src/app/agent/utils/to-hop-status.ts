import { ProviderAttemptDeadlineError } from "../../providers/errors/provider-attempt-deadline-error";
import { RunBudgetStoppedError } from "../errors/run-budget-stopped.error";
import type { ChildRunStatus } from "../types/child-run-status";

/** RNX-121b-1: how a hop that failed ended: at the run's budget, past its model call's deadline, or with any other error (an abort included). */
export function toHopStatus(err: unknown): Exclude<ChildRunStatus, "completed" | "refused"> {
  if (err instanceof RunBudgetStoppedError) return "budget_stopped";
  if (err instanceof ProviderAttemptDeadlineError) return "timeout";
  return "error";
}
