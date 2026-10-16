import { slugify } from "./slugify";

// The agent and workspace services had identical copies; RX-131 merged them here.
describe.each([
  { copy: "common/utils", slugify },
])("RX-131: slugify ($copy)", ({ slugify }) => {
  it.each([
    { name: "words become lower case, joined by a dash", input: "My Agent", expected: "my-agent" },
    { name: "spaces around are dropped", input: "  Sales  Bot  ", expected: "sales-bot" },
    { name: "punctuation becomes a dash", input: "Agent_v2.0!", expected: "agent-v2-0" },
    { name: "accented letters are dropped, not transliterated", input: "Café Ü", expected: "caf" },
    { name: "digits stay", input: "123", expected: "123" },
    { name: "a run of dashes becomes one", input: "a--b", expected: "a-b" },
    { name: "already a slug", input: "already-slugged", expected: "already-slugged" },
    { name: "only punctuation", input: "!!!", expected: "" },
    { name: "empty name", input: "", expected: "" },
  ])("$name: '$input' -> '$expected'", ({ input, expected }) => {
    const actual = slugify(input);

    expect(actual).toBe(expected);
  });
});
