import type { ChildRunStatus } from "./child-run-status";

/**
 * RNX-302: what a hop (a child run) records: the called agent, the runner (who ran the top-level run and pays), its
 * depth (the parent's depth + 1), how it ended and how long it took, the ledger call id of the parent's model call that
 * made it, the task given to the agent (stored as its user message) and the approved answer (its assistant message).
 */
export type ChildRunInput = {
  readonly parentRunId: string;
  readonly agentId: string;
  readonly userId: string;
  readonly depth: number;
  readonly status: ChildRunStatus;
  readonly durationMs: number;
  readonly parentCallId: string;
  readonly task: string;
  readonly answer: string;
};
