/**
 * RNX-327: what the pre-run estimate counts for a run's linked agents (docs/credits.md section 13.3): L's limit, the
 * agent calls per run (`peerRunMaxAgentCalls`), and the model calls counted for each linked agent.
 */
export type LinkedCallLimits = {
  readonly agentCalls: number;
  readonly callsPerLinkedAgent: number;
};
