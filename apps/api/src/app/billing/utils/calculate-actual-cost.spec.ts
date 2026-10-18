import { calculateActualCost } from "./calculate-actual-cost";

// RX-21: credits = (new input x input rate + cached x cached rate + output x output rate) / 1,000,000
// (docs/credits.md section 1.3). Each rate is the tier's credits-per-1,000,000-tokens figure.
describe("RX-21: calculateActualCost (the section 1.3 formula, tier rates per 1,000,000 tokens)", () => {
  it.each([
    { name: "zero tokens", inputTokens: 0, outputTokens: 0, inputRate: 1, outputRate: 1, expected: "0" },
    {
      name: "standard rates 1/1, 1,000,000 mixed tokens = 1 credit",
      inputTokens: 1_000_000,
      outputTokens: 0,
      inputRate: 1,
      outputRate: 1,
      expected: "1",
    },
    {
      name: "standard 360,000 input + 100,000 output (the definition mix, cached at 1)",
      inputTokens: 900_000,
      outputTokens: 100_000,
      inputRate: 1,
      outputRate: 1,
      expected: "1",
    },
    {
      name: "advanced rates 5/6",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      inputRate: 5,
      outputRate: 6,
      expected: "8",
    },
    {
      name: "premium rates 10/20",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      inputRate: 10,
      outputRate: 20,
      expected: "20",
    },
    {
      name: "rate pair 17/17 (math example, no tier decided by this test)",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      inputRate: 17,
      outputRate: 17,
      expected: "25.5",
    },
    {
      name: "input tokens only use the input rate",
      inputTokens: 200_000,
      outputTokens: 0,
      inputRate: 5,
      outputRate: 6,
      expected: "1",
    },
    {
      name: "output tokens only use the output rate",
      inputTokens: 0,
      outputTokens: 1_000_000,
      inputRate: 5,
      outputRate: 6,
      expected: "6",
    },
    {
      name: "no binary float error (0.1 + 0.2)",
      inputTokens: 1_000_000,
      outputTokens: 2_000_000,
      inputRate: 0.1,
      outputRate: 0.1,
      expected: "0.3",
    },
  ])("$name", ({ inputTokens, outputTokens, inputRate, outputRate, expected }) => {
    const actual = calculateActualCost(inputTokens, outputTokens, inputRate, outputRate);

    expect(actual.toFixed()).toBe(expected);
  });

  describe("cached tokens (RX-21)", () => {
    it("prices reported cached tokens at the cached rate, the rest at the input rate", () => {
      // 200,000 x 5 + 800,000 x 4 + 500,000 x 6 = 1,000,000 + 3,200,000 + 3,000,000 = 7.2 credits
      const actual = calculateActualCost(1_000_000, 500_000, 5, 6, 800_000, 4);

      expect(actual.toFixed()).toBe("7.2");
    });

    it("falls back to the input rate when no cached rate is given", () => {
      const actual = calculateActualCost(1_000_000, 500_000, 5, 6, 800_000);

      // (200,000 + 800,000) x 5 + 500,000 x 6 = 8,000,000 / 1,000,000 = 8 credits
      expect(actual.toFixed()).toBe("8");
    });

    it("with no cached tokens the cached rate does not matter", () => {
      const actual = calculateActualCost(1_000_000, 500_000, 5, 6, 0, 4);

      expect(actual.toFixed()).toBe("8");
    });

    it("prices all input as cached when the provider reports more cached tokens than input", () => {
      // fresh input clamped to 0: 800,000 x 4 = 3.2 credits
      const actual = calculateActualCost(500_000, 0, 5, 6, 800_000, 4);

      expect(actual.toFixed()).toBe("3.2");
    });
  });
});
