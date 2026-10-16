import { WebSearchService } from "./web-search.service";

describe("RX-131: getDefaultPolicy (the web search policy of a workspace that has none stored)", () => {
  it("allows brave-search only, 5 results, 100 searches a day per user", () => {
    const actual = WebSearchService.prototype.getDefaultPolicy();

    expect(actual).toEqual({ allowedProviders: ["brave-search"], preferredProvider: "brave-search", maxResults: 5, dailyLimitPerUser: 100 });
  });

  it("returns a new object on every call", () => {
    const actualFirst = WebSearchService.prototype.getDefaultPolicy();
    const actualSecond = WebSearchService.prototype.getDefaultPolicy();

    expect(actualFirst).not.toBe(actualSecond);
  });
});
