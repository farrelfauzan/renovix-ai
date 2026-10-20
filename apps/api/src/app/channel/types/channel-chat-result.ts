/** The reply of one channel chat message: its content, the tokens of its model calls and the saved assistant message. */
export type ChannelChatResult = {
  readonly content: string;
  readonly totalTokens: number;
  readonly assistantMessageId?: string;
};
