import { inferNameFromMarkdown } from "./infer-name-from-markdown";

describe("RX-131: inferNameFromMarkdown (a file name from the markdown's title words)", () => {
  it.each([
    { name: "heading and first sentence", markdown: "# Quarterly Sales Report\n\nRevenue grew in Q3.", expected: "quarterly-sales-revenue-grew-q3" },
    { name: "a heading of stop words only", markdown: "# The Report", expected: "the-report" },
    { name: "an accented letter splits a word, one-letter parts are dropped", markdown: "# Café Déjà Vu", expected: "caf-vu" },
    { name: "empty markdown", markdown: "", expected: "" },
    { name: "only a table separator", markdown: "| --- |", expected: "" },
  ])("$name", ({ markdown, expected }) => {
    const actual = inferNameFromMarkdown(markdown);

    expect(actual).toBe(expected);
  });
});
