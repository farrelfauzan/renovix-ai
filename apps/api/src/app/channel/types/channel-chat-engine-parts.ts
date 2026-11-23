import type { CallableAgent } from "../../agent/types/callable-agent";
import type { ChannelChatPersistence } from "../adapters/channel-chat-persistence.adapter";
import type { ChannelChatTurn } from "./channel-chat-turn";

/**
 * RNX-24a: what one channel chat message's chat engine is built from: its turn, the channel agent, its callable agents,
 * its persistence, the document format asked for, the route's abort signal (D336) and the runner's saved language.
 */
export type ChannelChatEngineParts = {
  readonly turn: ChannelChatTurn;
  readonly agent: { readonly id: string; readonly name: string; readonly systemPrompt: string };
  readonly callableAgents: readonly CallableAgent[];
  readonly persistence: ChannelChatPersistence;
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
  readonly runnerLocale?: string | null;
};
