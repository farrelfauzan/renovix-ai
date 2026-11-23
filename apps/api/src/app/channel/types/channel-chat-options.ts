/**
 * How the channel route runs a message besides its text: the document format asked for, and (RNX-24a, D336) the SSE
 * helper's abort signal, aborted when the client leaves.
 */
export type ChannelChatOptions = {
  readonly documentFormat?: string;
  readonly signal?: AbortSignal;
};
