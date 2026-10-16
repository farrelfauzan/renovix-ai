import { DocumentService } from "./document.service";

// The file under test loads marked (ESM-only, Jest cannot load it); this function does not use it.
jest.mock("marked", () => ({}));

describe("RX-131: stripInlineMarkdown (inline markdown marks removed, their text kept)", () => {
  it.each([
    { name: "plain text", text: "plain", expected: "plain" },
    { name: "empty text", text: "", expected: "" },
    { name: "bold with stars", text: "**bold**", expected: "bold" },
    { name: "italic with a star", text: "*italic*", expected: "italic" },
    { name: "bold with underscores", text: "__bold__", expected: "bold" },
    { name: "italic with an underscore", text: "_italic_", expected: "italic" },
    { name: "inline code", text: "`code`", expected: "code" },
    { name: "a link keeps its text", text: "[docs](https://example.test)", expected: "docs" },
    { name: "strikethrough", text: "~~old~~", expected: "old" },
    { name: "several marks", text: "mix **a** and *b*", expected: "mix a and b" },
    { name: "bold italic", text: "***both***", expected: "both" },
    { name: "an unclosed mark stays", text: "**bold", expected: "**bold" },
    { name: "underscores inside a word are read as italics (today's behaviour)", text: "snake_case_name", expected: "snakecasename" },
    { name: "multiplication stars are read as italics (today's behaviour)", text: "2 * 3 * 4", expected: "2  3  4" },
  ])("$name: '$text' -> '$expected'", ({ text, expected }) => {
    const actual = DocumentService.prototype["stripInlineMarkdown"](text);

    expect(actual).toBe(expected);
  });
});
