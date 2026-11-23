import type { ChannelChatTurn } from "../types/channel-chat-turn";

/** RNX-24a: a new turn for one channel chat message: nothing stored, counted or stopped yet, and no agent_runs row. */
export function createChannelChatTurn(
  identity: Pick<ChannelChatTurn, "agentId" | "userId" | "channelId" | "channelAgentId" | "message" | "scope">,
): ChannelChatTurn {
  return { ...identity, isUserMessageSaved: false, totalTokens: 0, isBudgetStopped: false, isMaxSteps: false };
}
