/** Chunks taken from each attached knowledge base for the run's knowledge context (the same as the agent run's). */
export const CHAT_ENGINE_KNOWLEDGE_TOP_K_PER_BASE = 3;

/** The decline shown when the input guardrail rejects the input without a user message (the agent run's text). */
export const CHAT_ENGINE_DEFAULT_DECLINE = "I'm not able to help with that request.";

/** The max_tokens of a model call when the agent sets none (the legacy loops' value, RNX-283). */
export const CHAT_ENGINE_DEFAULT_MAX_TOKENS = 4096;

/** The tool result of a call_agent attempt while the peer port is empty (RNX-283; delegation is RNX-121). */
export const CHAT_ENGINE_PEER_UNAVAILABLE = "Error: Calling another agent is unavailable.";
