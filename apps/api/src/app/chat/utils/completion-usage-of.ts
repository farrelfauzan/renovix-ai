/**
 * The OpenAI `usage` of a streamed answer's usage chunk (RNX-196), from the tokens its ledger usage entry records:
 * prompt = new + cached input, cached input as `prompt_tokens_details.cached_tokens`, completion = output.
 */
export function completionUsageOf(entry: {
  readonly tokensNew: number | null;
  readonly tokensCached: number | null;
  readonly tokensOut: number | null;
}) {
  const cachedTokens = entry.tokensCached ?? 0;
  const promptTokens = (entry.tokensNew ?? 0) + cachedTokens;
  const completionTokens = entry.tokensOut ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: { cached_tokens: cachedTokens },
  };
}
