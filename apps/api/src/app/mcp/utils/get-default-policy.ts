import type { WebSearchPolicy } from "../service/web-search.service";

export function getDefaultPolicy(): WebSearchPolicy {
  return {
    allowedProviders: ["brave-search"],
    preferredProvider: "brave-search",
    maxResults: 5,
    dailyLimitPerUser: 100,
  };
}
