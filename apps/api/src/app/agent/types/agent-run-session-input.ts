/** RNX-25: a new top-level agent run (a session row): the agent, the runner it belongs to and the session id. */
export type AgentRunSessionInput = {
  readonly agentId: string;
  readonly userId: string;
  readonly sessionId: string;
};
