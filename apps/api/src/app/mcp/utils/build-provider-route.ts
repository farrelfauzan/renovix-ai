import type { WebSearchPolicy, WebSearchProvider } from "../service/web-search.service";

export function buildProviderRoute(policy: WebSearchPolicy): WebSearchProvider[] {
  const unique = Array.from(new Set(policy.allowedProviders));
  const preferred = policy.preferredProvider;
  return [preferred, ...unique.filter((p) => p !== preferred)];
}
