import { McpUserService } from "./mcp-user.service";

describe("RX-131: getOAuthProvider (the OAuth app an MCP provider signs in with)", () => {
  it.each([
    { name: "google drive", provider: "google-drive", expected: "google" },
    { name: "google calendar", provider: "google-calendar", expected: "google" },
    { name: "google without a dash is returned as it is", provider: "google", expected: "google" },
    { name: "github", provider: "github", expected: "github" },
    { name: "a github variant", provider: "github-enterprise", expected: "github" },
    { name: "a prefix match only", provider: "githubx", expected: "github" },
    { name: "slack", provider: "slack", expected: "slack" },
    { name: "a slack variant", provider: "slack-bot", expected: "slack" },
    { name: "another provider is returned as it is", provider: "notion", expected: "notion" },
    { name: "case-sensitive", provider: "Slack", expected: "Slack" },
  ])("$name: '$provider' -> '$expected'", ({ provider, expected }) => {
    const actual = McpUserService.prototype["getOAuthProvider"](provider);

    expect(actual).toBe(expected);
  });
});
