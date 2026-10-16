import { WebSearchService } from "./web-search.service";

describe("RX-131: getSupportedProviders (the web search providers)", () => {
  it("is brave-search and duckduckgo, in that order", () => {
    const actual = WebSearchService.prototype.getSupportedProviders();

    expect(actual).toEqual(["brave-search", "duckduckgo"]);
  });
});
