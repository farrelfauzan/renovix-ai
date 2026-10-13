import { BillingService } from "./billing.service";

describe("RX-130: estimateTokens (characters / 4, rounded up)", () => {
  it.each([
    { name: "no messages", messages: [], expected: 0 },
    { name: "one empty message", messages: [{ content: "" }], expected: 0 },
    { name: "1 character rounds up to 1", messages: [{ content: "a" }], expected: 1 },
    { name: "4 characters are exactly 1", messages: [{ content: "abcd" }], expected: 1 },
    { name: "5 characters round up to 2", messages: [{ content: "abcde" }], expected: 2 },
    { name: "8 characters are exactly 2", messages: [{ content: "abcdefgh" }], expected: 2 },
    {
      name: "characters are summed before rounding (1 + 1 characters is 1 token, not 2)",
      messages: [{ content: "a" }, { content: "b" }],
      expected: 1,
    },
    {
      name: "several messages with a remainder (3 + 4 + 2 characters)",
      messages: [{ content: "abc" }, { content: "abcd" }, { content: "ab" }],
      expected: 3,
    },
    { name: "long input, exact (100000 characters)", messages: [{ content: "x".repeat(100_000) }], expected: 25_000 },
    { name: "long input, remainder (100001 characters)", messages: [{ content: "x".repeat(100_001) }], expected: 25_001 },
    { name: "an emoji counts as 2 characters (3 emoji = 6)", messages: [{ content: "😀😀😀" }], expected: 2 },
  ])("$name -> $expected", ({ messages, expected }) => {
    const actual = new BillingService(undefined as never).estimateTokens(messages);

    expect(actual).toBe(expected);
  });
});
