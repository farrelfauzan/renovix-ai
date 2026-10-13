/**
 * Estimate token count from messages using char count / 4 approximation.
 */
export function estimateTokens(messages: { content: string }[]): number {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.ceil(totalChars / 4);
}
