import { buildFallbackTitle } from "./build-fallback-title";

describe("RX-131: buildFallbackTitle (a conversation title from the first six words of a message)", () => {
  it.each([
    { name: "empty message", content: "", expected: "New Conversation" },
    { name: "only spaces", content: "   ", expected: "New Conversation" },
    { name: "six words stay", content: "How do I file my taxes", expected: "How do I file my taxes" },
    { name: "cut to six words", content: "Please help me write a cover letter for a job", expected: "Please help me write a cover" },
    { name: "a code block only", content: "```js\nconsole.log(1)\n```", expected: "New Conversation" },
    { name: "a code block is dropped from the text", content: "Fix this ```const a = 1;``` please", expected: "Fix this please" },
    { name: "a markdown link keeps its text", content: "Read [the docs](https://example.test/docs) today", expected: "Read the docs today" },
    { name: "line breaks become spaces", content: "Line one\nLine two\r\nLine three", expected: "Line one Line two Line three" },
    { name: "punctuation stays", content: "Hello, world!", expected: "Hello, world!" },
  ])("$name", ({ content, expected }) => {
    const actual = buildFallbackTitle(content);

    expect(actual).toBe(expected);
  });
});
