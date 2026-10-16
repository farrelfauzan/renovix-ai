import { sanitizeFilename } from "./sanitize-filename";
import { summarizeMarkdownForTitle } from "./summarize-markdown-for-title";

export function inferNameFromMarkdown(markdown: string): string {
  const summary = summarizeMarkdownForTitle(markdown);
  return sanitizeFilename(summary);
}
