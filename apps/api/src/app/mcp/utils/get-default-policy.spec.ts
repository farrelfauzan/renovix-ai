import { getDefaultPolicy } from "./get-default-policy";

describe("RX-131: getDefaultPolicy (the web search policy of a workspace that has none stored)", () => {
  it("allows brave-search only, 5 results, 100 searches a day per user", () => {
    const actual = getDefaultPolicy();

    expect(actual).toEqual({ allowedProviders: ["brave-search"], preferredProvider: "brave-search", maxResults: 5, dailyLimitPerUser: 100 });
  });

  it("returns a new object on every call", () => {
    const actualFirst = getDefaultPolicy();
    const actualSecond = getDefaultPolicy();

    expect(actualFirst).not.toBe(actualSecond);
  });
});
