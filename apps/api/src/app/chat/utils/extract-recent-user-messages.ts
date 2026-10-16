import type { ChatMessage } from "../service/prompt-template.service";

/**
 * Returns last few user messages (oldest -> newest) for intent classification.
 */
export function extractRecentUserMessages(messages: ChatMessage[]): string[] {
  return messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content.toLowerCase());
}
