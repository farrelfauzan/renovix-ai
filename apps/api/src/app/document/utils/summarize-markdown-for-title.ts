import { stripInlineMarkdown } from "./strip-inline-markdown";

export function summarizeMarkdownForTitle(markdown: string): string {
  const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
  const heading = headingMatch?.[1]
    ? stripInlineMarkdown(headingMatch[1])
    : "";

  let firstSentence = "";
  const lines = markdown.split("\n");
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }
    if (/^#{1,6}\s+/.test(normalized)) {
      continue;
    }
    if (/^[\s|:-]+$/.test(normalized)) {
      continue;
    }

    const plain = stripInlineMarkdown(
      normalized
        .replace(/^>\s*/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^\[[ xX]\]\s+/, ""),
    );
    if (!plain) {
      continue;
    }

    firstSentence = plain.split(/[.!?]/)[0]?.trim() || plain;
    if (firstSentence) {
      break;
    }
  }

  const source = [heading, firstSentence].filter(Boolean).join(" ").trim();
  if (!source) {
    return "";
  }

  const stopWords = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "this",
    "that",
    "these",
    "those",
    "report",
    "guide",
    "overview",
    "comprehensive",
  ]);

  const words = source
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);

  const focused = words.filter((word) => !stopWords.has(word));
  const selected = (focused.length >= 3 ? focused : words).slice(0, 6);
  return selected.join(" ");
}
