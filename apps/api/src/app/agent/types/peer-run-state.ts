import type { RunScope } from "./run-scope";

/**
 * RNX-121b-1: the agent calls of one agent message, local to that message's request and passed by reference (nothing is
 * shared between requests or API instances): the runner who pays, the run's scope and abort signal, the call stack
 * (agent ids, the run's own agent first) and how many agent calls have started.
 */
export type PeerRunState = {
  readonly runnerUserId: string;
  readonly scope: RunScope;
  readonly signal?: AbortSignal;
  readonly stack: string[];
  agentCalls: number;
};
