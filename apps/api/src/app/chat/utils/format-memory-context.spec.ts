import { formatMemoryContext } from "./format-memory-context";

describe("RX-131: formatMemoryContext (the user's memories as a prompt block)", () => {
  it.each([
    { name: "no memories", memories: [], expected: null },
    { name: "only an unknown type", memories: [{ type: "fact", content: "x" }], expected: null },
    { name: "one interest", memories: [{ type: "interest", content: "hiking" }], expected: "[User Memory Context]\n- Interests: hiking" },
    {
      name: "all four types, several of one",
      memories: [
        { type: "interest", content: "a" },
        { type: "interest", content: "b" },
        { type: "preference", content: "c" },
        { type: "context", content: "d" },
        { type: "exclusion", content: "e" },
      ],
      expected: "[User Memory Context]\n- Interests: a; b\n- Preferences: c\n- Context: d\n- Do-not-assume: e",
    },
    {
      name: "fixed order whatever the input order, unknown types dropped",
      memories: [
        { type: "exclusion", content: "e" },
        { type: "fact", content: "x" },
        { type: "interest", content: "a" },
      ],
      expected: "[User Memory Context]\n- Interests: a\n- Do-not-assume: e",
    },
  ])("$name", ({ memories, expected }) => {
    const actual = formatMemoryContext(memories);

    expect(actual).toBe(expected);
  });
});
