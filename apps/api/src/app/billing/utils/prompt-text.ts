/**
 * The prompt actually sent, as one text (RX-22): every message's role and content (after prompt tuning, knowledge
 * context included; non-string content as its JSON), then the tool definitions' JSON when there are any. The token
 * counters count this text.
 */
export function promptText(messages: readonly { role: string; content: unknown }[], tools: readonly unknown[] = []): string {
  const messageText = messages
    .map((message) => message.role + (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
    .join("");
  return tools.length > 0 ? messageText + JSON.stringify(tools) : messageText;
}
