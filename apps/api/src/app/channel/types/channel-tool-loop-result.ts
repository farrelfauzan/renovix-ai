import type { ChannelChatResult } from "./channel-chat-result";

/**
 * What the tool loop of one channel chat message gives back (RNX-284): the reply, and the approved, saved answer to
 * hand to the memory extraction once the run's reservation is closed; null for a blocked answer, an empty answer and
 * the max-steps message.
 */
export type ChannelToolLoopResult = {
  readonly reply: ChannelChatResult;
  readonly memoryInput: string | null;
};
