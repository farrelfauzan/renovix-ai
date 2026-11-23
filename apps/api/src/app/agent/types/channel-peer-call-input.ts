import type { CallableAgent } from "./callable-agent";
import type { PeerRunState } from "./peer-run-state";

/**
 * RNX-24a: what the peer port of a channel chat message's agent is built from: the agent, the agents it may call, the
 * run's peer-run state, and (D380) the id of the channel run's agent_runs row, its hops' parent, written on first ask.
 */
export type ChannelPeerCallInput = {
  readonly agent: { readonly id: string; readonly name: string };
  readonly callableAgents: readonly CallableAgent[];
  readonly state: PeerRunState;
  readonly findParentRunId: () => Promise<string>;
};
