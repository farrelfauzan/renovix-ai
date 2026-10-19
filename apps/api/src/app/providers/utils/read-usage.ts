import type { ChatUsage } from "../provider.interface";

/**
 * A provider's `usage` object as ChatUsage (RX-22), or undefined when there is none. The cached input tokens come
 * from `prompt_tokens_details.cached_tokens` (0 when the provider reports none); `prompt_tokens` includes them.
 */
export function readUsage(usage: unknown): ChatUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details } = usage as Record<string, any>;
  return {
    prompt_tokens: Number(prompt_tokens ?? 0),
    completion_tokens: Number(completion_tokens ?? 0),
    total_tokens: Number(total_tokens ?? 0),
    cachedTokens: Number(prompt_tokens_details?.cached_tokens ?? 0),
  };
}
