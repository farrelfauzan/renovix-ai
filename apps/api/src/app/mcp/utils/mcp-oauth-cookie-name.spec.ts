import { mcpOAuthCookieName } from "./mcp-oauth-cookie-name";

describe("RX-152: mcpOAuthCookieName (the cookie of a provider's OAuth flow)", () => {
  it.each([
    { name: "production has the __Host- prefix", provider: "google-gmail", isProduction: true, expected: "__Host-mcp_oauth_google-gmail" },
    { name: "plain-http localhost has no prefix", provider: "google-gmail", isProduction: false, expected: "mcp_oauth_google-gmail" },
    { name: "one cookie per provider", provider: "github", isProduction: true, expected: "__Host-mcp_oauth_github" },
  ])("$name", ({ provider, isProduction, expected }) => {
    const actual = mcpOAuthCookieName(provider, isProduction);

    expect(actual).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["an attribute after a semicolon", "github; Domain=evil.test"],
    ["an equals sign", "github=x"],
    ["a space", "git hub"],
    ["a line break", "github\r\nSet-Cookie: x=y"],
    ["over 100 characters", "a".repeat(101)],
  ])("refuses a provider id with %s", (_label, provider) => {
    expect(mcpOAuthCookieName(provider, true)).toBeNull();
    expect(mcpOAuthCookieName(provider, false)).toBeNull();
  });
});
