/** RNX-283: a tool result as the model gets it back: cut to `maxChars` with the legacy "[truncated]" mark, or whole when the source keeps it whole (null). */
export function truncateToolResult(result: string, maxChars: number | null): string {
  if (maxChars === null || result.length <= maxChars) return result;
  return `${result.slice(0, maxChars)}\n...[truncated]`;
}
