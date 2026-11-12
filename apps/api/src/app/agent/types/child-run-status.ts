/**
 * RNX-302: how a hop (a child run: an agent called by a model call of its parent run) ended. Completed with an
 * approved answer, refused before it ran, failed with an error, timed out, or stopped at the run's budget.
 */
export type ChildRunStatus = "completed" | "refused" | "error" | "timeout" | "budget_stopped";
