import type { RunScope } from "./run-scope";

/**
 * RNX-121b-1: the agent calls of one agent message, local to that message's request and passed by reference (nothing is
 * shared between requests or API instances): the runner who pays, the run's scope and abort signal, the call stack
 * (agent ids, the run's own agent first) and how many agent calls have started. RNX-326: the run limits: when the run
 * started, the route's socket timeout (when it sets one), the model calls started (root and hops), and the run's stop
 * (aborted with RunLimitStoppedError at a run limit). The model-call cap and the stop timer are set at the run's first
 * agent call; the run's execution clears the timer when the run ends.
 */
export type PeerRunState = {
  readonly runnerUserId: string;
  readonly scope: RunScope;
  readonly signal?: AbortSignal;
  readonly stack: string[];
  agentCalls: number;
  readonly startedAt: number;
  readonly socketTimeoutMs?: number;
  modelCalls: number;
  readonly stop: AbortController;
  maxModelCalls?: number;
  stopTimer?: ReturnType<typeof setTimeout>;
};
