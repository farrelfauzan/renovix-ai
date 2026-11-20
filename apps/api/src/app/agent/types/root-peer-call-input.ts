import type { AgentRunTurn } from "./agent-run-turn";
import type { CallableAgent } from "./callable-agent";

/** RNX-121b-1: what the peer port of an agent message's own agent is built from: the turn, the agent, the agents it may call and the run's abort signal. */
export type RootPeerCallInput = {
  readonly turn: AgentRunTurn;
  readonly agent: { readonly id: string; readonly name: string };
  readonly callableAgents: readonly CallableAgent[];
  readonly signal?: AbortSignal;
};
