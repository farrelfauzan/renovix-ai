import type { SearchResult, WebSearchProvider } from "../service/web-search.service";
import { extractHostname } from "./extract-hostname";

export function formatForTool(
  query: string,
  provider: WebSearchProvider,
  results: SearchResult[],
): string {
  if (results.length === 0) {
    return `No relevant web results found for "${query}".`;
  }

  const lines: string[] = [];
  lines.push(`Top web results for "${query}" via ${provider}:`);
  results.forEach((result, idx) => {
    const hostname = extractHostname(result.url);
    lines.push(`${idx + 1}. ${result.title}`);
    lines.push(`   URL: ${result.url}`);
    if (hostname) lines.push(`   Source: ${hostname}`);
    lines.push(`   Snippet: ${result.snippet || "No snippet available."}`);
  });
  return lines.join("\n");
}
