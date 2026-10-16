import { WebSearchService } from "./web-search.service";

describe("RX-131: extractTitleFromTopic (a DuckDuckGo topic's title: the text before ' - ')", () => {
  it.each([
    { name: "empty", text: "", expected: "Untitled" },
    { name: "the text before ' - '", text: "Paris - capital of France", expected: "Paris" },
    { name: "spaces around the title are trimmed", text: "  Paris  - capital", expected: "Paris" },
    { name: "the first ' - ' only", text: "a-b - c - d", expected: "a-b" },
    { name: "' - ' at the very start is not used", text: " - starts with a dash", expected: " - starts with a dash" },
    { name: "no ' - '", text: "No dash here", expected: "No dash here" },
    { name: "no ' - ', cut to 80", text: "x".repeat(100), expected: `${"x".repeat(79)}...` },
  ])("$name", ({ text, expected }) => {
    const actual = WebSearchService.prototype["extractTitleFromTopic"](text);

    expect(actual).toBe(expected);
  });
});
