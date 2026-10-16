export function buildFallbackTitle(content: string): string {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "New Conversation";
  }

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);

  return words.join(" ");
}
