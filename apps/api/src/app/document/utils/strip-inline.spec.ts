import { stripInline } from "./strip-inline";

// The docx, pdf and xlsx converters had identical copies; RX-131 merged them here.
describe.each([
  { copy: "document/utils", stripInline },
])("RX-131: stripInline ($copy)", ({ stripInline }) => {
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
    const actual = stripInline(text);

    expect(actual).toBe(expected);
  });
});
