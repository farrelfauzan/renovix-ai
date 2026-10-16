import { getSupportedProviders } from "./get-supported-providers";

describe("RX-131: getSupportedProviders (the web search providers)", () => {
  it("is brave-search and duckduckgo, in that order", () => {
    const actual = getSupportedProviders();

    expect(actual).toEqual(["brave-search", "duckduckgo"]);
  });
});
