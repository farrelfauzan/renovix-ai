/** RNX-283: a call_agent attempt as the peer port receives it: who runs, which agent asks, and the model's arguments (not checked). */
export type ChatPeerCallRequest = {
  readonly runnerUserId: string;
  readonly agentId: string;
  readonly args: unknown;
};
