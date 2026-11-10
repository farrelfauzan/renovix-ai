/**
 * How an agent run's work ended, for closing its reservation (AgentRunMeterService.closeRun): completed, stopped at its
 * budget before a model call (docs/credits.md section 13.4), or failed (an error, an abort or a disconnect).
 */
export type RunEnding = "completed" | "budget_stopped" | "failed";
