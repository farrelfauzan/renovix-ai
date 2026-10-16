import { buildProviderRoute } from "./build-provider-route";

type Provider = "brave-search" | "duckduckgo";
const policy = (allowedProviders: Provider[], preferredProvider: Provider) => ({ allowedProviders, preferredProvider, maxResults: 5, dailyLimitPerUser: 100 });

describe("RX-131: buildProviderRoute (the providers to try, the preferred one first)", () => {
  it.each([
    { name: "one provider", allowed: ["brave-search"] as Provider[], preferred: "brave-search" as Provider, expected: ["brave-search"] },
    { name: "the preferred one first", allowed: ["brave-search", "duckduckgo"] as Provider[], preferred: "duckduckgo" as Provider, expected: ["duckduckgo", "brave-search"] },
    { name: "duplicates removed", allowed: ["duckduckgo", "duckduckgo"] as Provider[], preferred: "duckduckgo" as Provider, expected: ["duckduckgo"] },
    { name: "a preferred provider that is not allowed is still first", allowed: ["brave-search"] as Provider[], preferred: "duckduckgo" as Provider, expected: ["duckduckgo", "brave-search"] },
    { name: "nothing allowed: the preferred one only", allowed: [] as Provider[], preferred: "brave-search" as Provider, expected: ["brave-search"] },
  ])("$name", ({ allowed, preferred, expected }) => {
    const actual = buildProviderRoute(policy(allowed, preferred));

    expect(actual).toEqual(expected);
  });
});
