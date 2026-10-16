import { WebSearchService } from "./web-search.service";

describe("RX-131: isProvider (a value is a web search provider name)", () => {
  it.each([
    { name: "brave-search", value: "brave-search", expected: true },
    { name: "duckduckgo", value: "duckduckgo", expected: true },
    { name: "another name", value: "google", expected: false },
    { name: "case-sensitive", value: "Brave-Search", expected: false },
    { name: "empty", value: "", expected: false },
    { name: "undefined", value: undefined, expected: false },
    { name: "null", value: null, expected: false },
    { name: "a number", value: 1, expected: false },
  ])("$name -> $expected", ({ value, expected }) => {
    const actual = WebSearchService.prototype["isProvider"](value);

    expect(actual).toBe(expected);
  });
});
