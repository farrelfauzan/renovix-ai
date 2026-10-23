/**
 * One SSE event of a streamed POST /chat/completions answer (RNX-196): an OpenAI `chat.completion.chunk` of the stream
 * `head` (the same id, created and model on every chunk) with the given choices and, on the usage chunk, usage.
 * RNX-232: the last chunk also carries `credits_used`.
 */
export function completionChunk(
  head: { readonly id: string; readonly created: number; readonly model: string },
  part: { readonly choices: readonly object[]; readonly usage?: object; readonly credits_used?: string },
): string {
  const chunk = { id: head.id, object: "chat.completion.chunk", created: head.created, model: head.model, ...part };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}
