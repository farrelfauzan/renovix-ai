import { formatForTool } from "./format-for-tool";

const result = (title: string, url: string, snippet: string) => ({ title, url, snippet, provider: "brave-search" as const });

describe("RX-131: formatForTool (web search results as the text the model reads)", () => {
  it.each([
    { name: "no results", query: "renovix", results: [], expected: 'No relevant web results found for "renovix".' },
    {
      name: "one result",
      query: "renovix",
      results: [result("Example", "https://www.example.test/a", "Snippet text")],
      expected: 'Top web results for "renovix" via brave-search:\n1. Example\n   URL: https://www.example.test/a\n   Source: www.example.test\n   Snippet: Snippet text',
    },
    {
      name: "an empty snippet and a URL without a host name",
      query: "q",
      results: [result("No host", "not a url", "")],
      expected: 'Top web results for "q" via brave-search:\n1. No host\n   URL: not a url\n   Snippet: No snippet available.',
    },
    {
      name: "two results are numbered",
      query: "q",
      results: [result("A", "https://a.example.test/", "a"), result("B", "https://b.example.test/", "b")],
      expected:
        'Top web results for "q" via brave-search:\n1. A\n   URL: https://a.example.test/\n   Source: a.example.test\n   Snippet: a\n2. B\n   URL: https://b.example.test/\n   Source: b.example.test\n   Snippet: b',
    },
  ])("$name", ({ query, results, expected }) => {
    const actual = formatForTool(query, "brave-search", results);

    expect(actual).toBe(expected);
  });

  it("names the provider it was given", () => {
    const actual = formatForTool("q", "duckduckgo", [result("A", "https://a.example.test/", "a")]);

    expect(actual.split("\n")[0]).toBe('Top web results for "q" via duckduckgo:');
  });
});
