import { Decimal } from "@prisma/client/runtime/client";
import type { ChatUsage } from "../provider.interface";

/** The largest token count a ledger entry stores (the tokens columns are 32-bit integers). */
const MAX_TOKEN_COUNT = 2_147_483_647;

/** Whether a reported token count is a whole number of tokens the ledger can store. */
const isTokenCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TOKEN_COUNT;

/** RNX-162: whether a reported cost is a finite USD amount >= 0. */
const isUsdAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * A provider's `usage` object as ChatUsage (RX-22), or undefined when there is none or it cannot be trusted. The
 * cached input tokens come from `prompt_tokens_details.cached_tokens` (0 when the provider reports none) and are
 * clamped to prompt_tokens, which includes them. Any reported count that is not a whole number from 0 to 2^31 - 1
 * (NaN, negative, fractional, a string, too large, or prompt/completion missing) makes the whole report untrusted:
 * undefined, so the caller treats the call as reporting no usage instead of charging from a bad number.
 * RNX-162: the reported cost (`cost`, USD, as a Decimal) and the reasoning tokens
 * (`completion_tokens_details.reasoning_tokens`) are added when present and valid (a finite cost >= 0, a token count);
 * an invalid one is left out and never makes the report untrusted.
 */
export function readUsage(usage: unknown): ChatUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details, completion_tokens_details, cost } =
    usage as Record<string, any>;
  const cached = prompt_tokens_details?.cached_tokens ?? 0;
  if (!isTokenCount(prompt_tokens) || !isTokenCount(completion_tokens) || !isTokenCount(cached)) return undefined;
  const reasoning = completion_tokens_details?.reasoning_tokens;
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: isTokenCount(total_tokens) ? total_tokens : prompt_tokens + completion_tokens,
    cachedTokens: Math.min(cached, prompt_tokens),
    ...(isUsdAmount(cost) && { costUsd: new Decimal(cost) }),
    ...(isTokenCount(reasoning) && { reasoningTokens: reasoning }),
  };
}
