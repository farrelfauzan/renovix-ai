import type { WebSearchProvider } from "../service/web-search.service";

export function isProvider(value: unknown): value is WebSearchProvider {
  return value === "brave-search" || value === "duckduckgo";
}
