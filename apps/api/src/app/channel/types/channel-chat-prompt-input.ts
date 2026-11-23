import type { CallableAgent } from "../../agent/types/callable-agent";

/**
 * RNX-24a: what the channel chat's (CH) system prompt is built from, as the legacy CH loop built it: the agent's prompt,
 * the room's workspace memory, its callable agents, the document format asked for and (RNX-335) the runner's saved
 * language.
 */
export type ChannelChatPromptInput = {
  readonly systemPrompt: string;
  readonly memory: string;
  readonly callableAgents: readonly CallableAgent[];
  readonly documentFormat?: string;
  readonly runnerLocale?: string | null;
};
