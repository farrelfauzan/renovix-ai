import { calculateActualCost } from "./calculate-actual-cost";

describe("RX-130: calculateActualCost ((input tokens x input price + output tokens x output price) x credit multiplier)", () => {
  it.each([
    { name: "zero tokens", inputTokens: 0, outputTokens: 0, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1, expected: "0" },
    { name: "multiplier 1", inputTokens: 1000, outputTokens: 500, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1, expected: "0.00045" },
    { name: "multiplier 1.5", inputTokens: 1000, outputTokens: 500, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1.5, expected: "0.000675" },
    { name: "multiplier 0", inputTokens: 1000, outputTokens: 500, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 0, expected: "0" },
    { name: "input tokens only use the input price", inputTokens: 1000, outputTokens: 0, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1, expected: "0.00015" },
    { name: "output tokens only use the output price", inputTokens: 0, outputTokens: 1000, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1, expected: "0.0006" },
    { name: "more input than output", inputTokens: 2000, outputTokens: 300, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1, expected: "0.00048" },
    { name: "the same counts swapped cost more (output is dearer)", inputTokens: 300, outputTokens: 2000, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1, expected: "0.001245" },
    { name: "one token each, 12-decimal prices", inputTokens: 1, outputTokens: 1, inputPrice: 0.000001234567, outputPrice: 0.000007654321, multiplier: 1.5, expected: "0.000013333332" },
    { name: "large token counts, multiplier 1.5", inputTokens: 123_456_789, outputTokens: 987_654_321, inputPrice: 0.00000015, outputPrice: 0.0000006, multiplier: 1.5, expected: "916.666666425" },
    { name: "no binary float error (0.1 + 0.2)", inputTokens: 1, outputTokens: 2, inputPrice: 0.1, outputPrice: 0.1, multiplier: 1, expected: "0.3" },
  ])(
    "$name: ($inputTokens x $inputPrice + $outputTokens x $outputPrice) x $multiplier = $expected",
    ({ inputTokens, outputTokens, inputPrice, outputPrice, multiplier, expected }) => {
      const actual = calculateActualCost(inputTokens, outputTokens, inputPrice, outputPrice, multiplier);

      expect(actual.toFixed()).toBe(expected);
    },
  );
});
