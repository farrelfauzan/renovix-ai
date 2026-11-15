import type { LinkedAgent } from "../../agent/types/linked-agent";

/** RNX-282: whose run the engine meters: the runner who pays, the agent that calls (on every usage entry), its workspace and its model identifier. RNX-25 (D341 D1): the agents it may call, counted in the reservation's minimum (none when not given). */
export type MeteredExecutionTarget = {
  readonly runnerUserId: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly model: string;
  readonly linkedAgents?: readonly LinkedAgent[];
};
