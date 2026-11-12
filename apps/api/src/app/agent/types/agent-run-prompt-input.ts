import type { CallableAgent } from "./callable-agent";

/** RNX-25: what the agent run's system prompt is built from: the agent's prompt, its callable agents, the permitted knowledge and memory, and the document format asked for. */
export type AgentRunPromptInput = {
  readonly systemPrompt: string;
  readonly callableAgents: readonly CallableAgent[];
  readonly knowledge: string;
  readonly memory: string;
  readonly documentFormat?: string;
};
