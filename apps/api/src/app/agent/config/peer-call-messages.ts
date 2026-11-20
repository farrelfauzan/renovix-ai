/**
 * RNX-121b-1: the tool results of agent calls that did not run (D351 6): arguments that are not valid, a cycle (the
 * agent is already on the call stack), the depth limit and the run's agent-call limit. A missing limit setting gives
 * the engine's "unavailable" text (CHAT_ENGINE_PEER_UNAVAILABLE).
 */
export const PEER_CALL_MESSAGES = {
  invalidArguments: "Error: Invalid call_agent arguments. Provide the name or id of a callable agent and a task.",
  cycle: "Error: That agent is already working in this chain of calls, so it was not called again.",
  depthLimit: "Error: That agent was not called: the chain of agent calls is already as deep as it may go.",
  agentCallLimit: "Error: That agent was not called: this run has made as many agent calls as it may.",
} as const;
