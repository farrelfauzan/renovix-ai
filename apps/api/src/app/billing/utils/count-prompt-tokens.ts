import { countTextTokens } from "./count-text-tokens";
import { promptText } from "./prompt-text";

/** Tokens a chat format adds around each message (role markers, separators), counted on top of its bytes. */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * The counted prompt I of the HOLD ESTIMATE (docs/credits.md section 3.1 rule 1, RX-22): the bytes of the prompt
 * actually sent (`promptText`: roles and contents after tuning, knowledge context included, plus the tools JSON) with
 * a fixed overhead per message. Never fewer tokens than the provider counts. Charges use `countCharTokens` instead.
 */
export function countPromptTokens(messages: readonly { role: string; content: unknown }[], tools: readonly unknown[] = []): number {
  return countTextTokens(promptText(messages, tools)) + messages.length * MESSAGE_OVERHEAD_TOKENS;
}
