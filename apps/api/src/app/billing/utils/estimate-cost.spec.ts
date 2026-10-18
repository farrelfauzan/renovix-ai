import { estimateCost } from "./estimate-cost";

// RX-21: credits = tokens x rate / 1,000,000 (docs/credits.md section 1.3); the rate is the
// tier's credits-per-1,000,000-tokens figure.
describe("RX-21: estimateCost (tokens x the tier's rate / 1,000,000)", () => {
  it.each([
    { name: "zero tokens", tokens: 0, rate: 1, expected: "0" },
    {
      name: "one token at rate 1 (standard) is a micro-credit",
      tokens: 1,
      rate: 1,
      expected: "0.000001",
    },
    {
      name: "standard rate 1: 1,000,000 tokens = 1 credit",
      tokens: 1_000_000,
      rate: 1,
      expected: "1",
    },
    { name: "standard rate 1: 250,000 tokens", tokens: 250_000, rate: 1, expected: "0.25" },
    { name: "advanced rate 5: 1,000,000 tokens", tokens: 1_000_000, rate: 5, expected: "5" },
    { name: "an undecided-tier rate 17 (math example): 500,000 tokens", tokens: 500_000, rate: 17, expected: "8.5" },
    {
      name: "large token count, rate 1",
      tokens: 999_999_999,
      rate: 1,
      expected: "999.999999",
    },
    {
      name: "no binary float error (3 x 0.1)",
      tokens: 3_000_000,
      rate: 0.1,
      expected: "0.3",
    },
  ])("$name: $tokens tokens x rate $rate = $expected credits", ({ tokens, rate, expected }) => {
    const actual = estimateCost(tokens, rate);

    expect(actual.toFixed()).toBe(expected);
  });
});
