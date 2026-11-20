import type { CallableAgent } from "./callable-agent";
import type { PeerHop } from "./peer-hop";
import type { PeerRunState } from "./peer-run-state";

/**
 * RNX-121b-1: an agent that may make call_agent calls in a run: the run's state, the agent itself, its depth (0 for the
 * run's own agent), the agents it may call and where each of its hops goes once it has ended.
 */
export type PeerCallFrame = {
  readonly state: PeerRunState;
  readonly agent: { readonly id: string; readonly name: string };
  readonly depth: number;
  readonly callableAgents: readonly CallableAgent[];
  readonly record: (hop: PeerHop) => Promise<void>;
};
