import { truncate } from "./truncate";

describe("RX-131: truncate (text cut to max - 1 characters plus '...')", () => {
  it.each([
    { name: "empty", value: "", max: 5, expected: "" },
    { name: "exactly max stays", value: "hello", max: 5, expected: "hello" },
    { name: "shorter stays", value: "abc", max: 10, expected: "abc" },
    { name: "one over max", value: "hello!", max: 5, expected: "hell..." },
    { name: "max 1", value: "abcdef", max: 1, expected: "..." },
    { name: "max 0 (slice to -1, today's behaviour)", value: "abcdef", max: 0, expected: "abcde..." },
  ])("$name: '$value', $max -> '$expected'", ({ value, max, expected }) => {
    const actual = truncate(value, max);

    expect(actual).toBe(expected);
  });
});
