import { truncate } from "./truncate";

export function extractTitleFromTopic(text: string): string {
  if (!text) return "Untitled";
  const idx = text.indexOf(" - ");
  if (idx > 0) {
    return text.slice(0, idx).trim();
  }
  return truncate(text, 80);
}
