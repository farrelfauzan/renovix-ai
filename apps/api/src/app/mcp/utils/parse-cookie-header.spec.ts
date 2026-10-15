import { parseCookieHeader } from "./parse-cookie-header";

describe("RX-152: parseCookieHeader (the Cookie header as name -> value)", () => {
  it("reads every cookie of one header, values as sent", () => {
    const actual = parseCookieHeader("mcp_oauth_github=abc_-1; theme=dark;mcp_oauth_google-gmail=x=y");

    expect([...actual]).toEqual([
      ["mcp_oauth_github", "abc_-1"],
      ["theme", "dark"],
      ["mcp_oauth_google-gmail", "x=y"],
    ]);
  });

  it("keeps the first value of a name that appears twice", () => {
    expect(parseCookieHeader("a=1; a=2").get("a")).toBe("1");
  });

  it.each([
    ["an absent header", undefined],
    ["an empty header", ""],
    ["pairs without a name or an equals sign", "=x; novalue; ;"],
  ])("gives no cookies for %s", (_label, header) => {
    expect(parseCookieHeader(header).size).toBe(0);
  });

  it("an empty value is an empty string", () => {
    expect(parseCookieHeader("a=").get("a")).toBe("");
  });
});
