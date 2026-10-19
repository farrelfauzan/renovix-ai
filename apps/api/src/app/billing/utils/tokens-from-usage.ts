import type { CallTokens } from "../types/call-tokens";

/**
 * The token kinds of a provider's usage report (RX-22): new input = prompt - cached (never below 0), cached input,
 * output.
 */
export function tokensFromUsage(promptTokens: number, cachedTokens: number, completionTokens: number): CallTokens {
  return {
    tokensNew: Math.max(0, promptTokens - cachedTokens),
    tokensCached: cachedTokens,
    tokensOut: completionTokens,
  };
}
