import type { ChatUsage } from "../../providers/provider.interface";
import type { CallTokens } from "../types/call-tokens";
import { countCharTokens } from "./count-char-tokens";
import { tokensFromUsage } from "./tokens-from-usage";

/**
 * The tokens to record for a streamed call (RX-22, D202-5, D205): the provider's usage chunk when one arrived. Without
 * one (the client went away before it, or a stream ended without it): the prompt sent as new input and the output
 * received so far, each counted locally with `countCharTokens` (ceil(characters / 4)), no cached input.
 */
export function streamedCallTokens(usage: ChatUsage | undefined, sentPrompt: string, receivedOutput: string): CallTokens {
  if (usage) return tokensFromUsage(usage.prompt_tokens, usage.cachedTokens ?? 0, usage.completion_tokens);
  return { tokensNew: countCharTokens(sentPrompt), tokensCached: 0, tokensOut: countCharTokens(receivedOutput) };
}
