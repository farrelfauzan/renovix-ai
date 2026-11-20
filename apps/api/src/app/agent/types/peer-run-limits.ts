/**
 * RNX-121b-1: the agent-call limits of a run, read from the platform settings (D46; no value in code): the deepest
 * call (peerRunMaxDepth), the agent calls per run (peerRunMaxAgentCalls) and the deadline of each model call of a
 * called agent (peerRunCallTimeoutSeconds, in milliseconds).
 */
export type PeerRunLimits = {
  readonly maxDepth: number;
  readonly maxAgentCalls: number;
  readonly callTimeoutMs: number;
};
