import { mcpOAuthSetCookie } from "./mcp-oauth-set-cookie";

const VALUE = "A".repeat(43);

describe("RX-152: mcpOAuthSetCookie (Set-Cookie of an OAuth flow's one-time value)", () => {
  it("production: HttpOnly, SameSite=Lax, Path=/, Max-Age and Secure, no Domain", () => {
    const actual = mcpOAuthSetCookie({ name: "__Host-mcp_oauth_github", value: VALUE, maxAgeSeconds: 600, isProduction: true });

    expect(actual).toBe(`__Host-mcp_oauth_github=${VALUE}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600; Secure`);
    expect(actual).not.toMatch(/domain/i);
  });

  it("plain-http localhost: the same without Secure", () => {
    const actual = mcpOAuthSetCookie({ name: "mcp_oauth_github", value: VALUE, maxAgeSeconds: 600, isProduction: false });

    expect(actual).toBe(`mcp_oauth_github=${VALUE}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
  });

  it.each([true, false])("clearing (isProduction %s): empty value and Max-Age=0 with the same attributes", (isProduction) => {
    const actual = mcpOAuthSetCookie({ name: "mcp_oauth_github", value: "", maxAgeSeconds: 0, isProduction });

    expect(actual).toBe(`mcp_oauth_github=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction ? "; Secure" : ""}`);
  });
});
