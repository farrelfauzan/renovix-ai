import type { RunScope } from "../../agent/types/run-scope";

/**
 * RNX-24a: one channel chat message on the chat engine, local to that message (never shared between runs): the agent,
 * the runner, the channel and its agent link, the raw message (the adapter's own copy), the run's scope (the channel
 * adapter's run policy answer), and what the run did: whether the user's message is stored, the stored answer's id,
 * the root agent's tokens, whether it stopped at its budget or at the loop's limit, and (D380) its agent_runs row,
 * written at its first agent call.
 */
export type ChannelChatTurn = {
  readonly agentId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly channelAgentId: string;
  readonly message: string;
  readonly scope: RunScope;
  isUserMessageSaved: boolean;
  assistantMessageId?: string;
  totalTokens: number;
  isBudgetStopped: boolean;
  isMaxSteps: boolean;
  channelRunId?: Promise<string>;
};
