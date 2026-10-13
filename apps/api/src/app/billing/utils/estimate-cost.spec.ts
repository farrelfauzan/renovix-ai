import { estimateCost } from "./estimate-cost";

describe("RX-130: estimateCost (tokens x input price x credit multiplier)", () => {
  it.each([
    { name: "zero tokens", tokens: 0, inputPrice: 0.00000015, multiplier: 1, expected: "0" },
    { name: "one token at a fractional price", tokens: 1, inputPrice: 0.00000015, multiplier: 1, expected: "0.00000015" },
    { name: "multiplier 1", tokens: 1000, inputPrice: 0.00000015, multiplier: 1, expected: "0.00015" },
    { name: "multiplier 1.5", tokens: 1000, inputPrice: 0.00000015, multiplier: 1.5, expected: "0.000225" },
    { name: "multiplier 0", tokens: 1000, inputPrice: 0.00000015, multiplier: 0, expected: "0" },
    { name: "price 0", tokens: 1000, inputPrice: 0, multiplier: 1.5, expected: "0" },
    { name: "large token count, multiplier 1.5", tokens: 999_999_999, inputPrice: 0.00000015, multiplier: 1.5, expected: "224.999999775" },
    { name: "large token count, whole result", tokens: 2_000_000_000, inputPrice: 0.000003, multiplier: 1, expected: "6000" },
    { name: "no binary float error (3 x 0.1)", tokens: 3, inputPrice: 0.1, multiplier: 1, expected: "0.3" },
    { name: "no binary float error (7 x 0.1 x 3)", tokens: 7, inputPrice: 0.1, multiplier: 3, expected: "2.1" },
  ])("$name: $tokens x $inputPrice x $multiplier = $expected", ({ tokens, inputPrice, multiplier, expected }) => {
    const actual = estimateCost(tokens, inputPrice, multiplier);

    expect(actual.toFixed()).toBe(expected);
  });
});
