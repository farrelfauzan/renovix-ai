/** RNX-282: whose run the engine meters: the runner who pays, the agent that calls (on every usage entry), its workspace and its model identifier. */
export type MeteredExecutionTarget = {
  readonly runnerUserId: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly model: string;
};
