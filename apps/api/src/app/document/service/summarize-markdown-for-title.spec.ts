import { DocumentService } from "./document.service";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

describe("RX-131: summarizeMarkdownForTitle (up to six words from the first heading and first sentence)", () => {
  it.each([
    { name: "empty markdown", markdown: "", expected: "" },
    { name: "heading and first sentence, stop words dropped", markdown: "# Quarterly Sales Report\n\nRevenue grew in Q3.", expected: "quarterly sales revenue grew q3" },
    { name: "no heading: the first sentence, inline marks removed", markdown: "Plan the **launch** event for Friday. Then more.", expected: "plan launch event friday" },
    { name: "fewer than three words left after the stop words: all words", markdown: "# The Report", expected: "the report" },
    { name: "quote and list marks removed", markdown: "> - Buy milk and eggs", expected: "buy milk eggs" },
    { name: "a checkbox mark removed", markdown: "- [x] Ship the release notes", expected: "ship release notes" },
    { name: "a number mark removed", markdown: "1. Draft the budget proposal", expected: "draft budget proposal" },
    { name: "a table separator line is skipped", markdown: "|---|---|\n| Name | Age |", expected: "name age" },
    { name: "cut to six words", markdown: "Alpha beta gamma delta epsilon zeta eta theta", expected: "alpha beta gamma delta epsilon zeta" },
    { name: "one-letter words dropped", markdown: "A b c dog cat", expected: "dog cat" },
    { name: "a line that starts with a period keeps the whole line", markdown: "...hello world", expected: "hello world" },
  ])("$name", ({ markdown, expected }) => {
    const actual = DocumentService.prototype["summarizeMarkdownForTitle"](markdown);

    expect(actual).toBe(expected);
  });
});
