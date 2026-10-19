import { Decimal } from "@prisma/client/runtime/client";
import { computeCallCredits } from "./compute-call-credits";

const rates = (rateNew: string, rateCached: string, rateOut: string) => ({
  rateNew: new Decimal(rateNew),
  rateCached: new Decimal(rateCached),
  rateOut: new Decimal(rateOut),
});

// RX-22: docs/credits.md sections 1.5 and 2.3 (D115 item 3): exact sum of the three products, one ceiling per call.
describe("computeCallCredits", () => {
  it.each([
    { name: "Standard 1/1/1 (section 1.5)", tokens: [18_437, 27_906, 3_215], rates: rates("1", "1", "1"), expected: "0.049558" },
    { name: "Advanced 5/6/4 (section 1.5)", tokens: [9_871, 14_263, 2_047], rates: rates("5", "6", "4"), expected: "0.143121" },
    { name: "Premium 10/20/11 (section 1.5)", tokens: [6_529, 21_874, 1_388], rates: rates("10", "20", "11"), expected: "0.518038" },
    { name: "Frontier 29/29/42 (section 1.5)", tokens: [4_183, 15_742, 2_961], rates: rates("29", "29", "42"), expected: "0.702187" },
    { name: "decimal rates, whole exact sum: no rounding (section 2.3)", tokens: [1_234, 566, 89], rates: rates("2.5", "0.25", "7.5"), expected: "0.003894" },
    { name: "decimal rates, 3,896.5 micro-credits: ceiling once, 3,897 (not 3,898 per kind)", tokens: [1_235, 566, 89], rates: rates("2.5", "0.25", "7.5"), expected: "0.003897" },
    { name: "D106: 3 tokens at 0.5 = 1.5 micro-credits -> 2", tokens: [2, 0, 1], rates: rates("0.5", "0.5", "0.5"), expected: "0.000002" },
    { name: "no tokens", tokens: [0, 0, 0], rates: rates("10", "20", "11"), expected: "0.000000" },
    { name: "a rate with 12 decimals stays exact before the ceiling", tokens: [999_999, 0, 0], rates: rates("0.000000000001", "1", "1"), expected: "0.000001" },
  ])("$name", ({ tokens: [tokensNew, tokensCached, tokensOut], rates: callRates, expected }) => {
    const actual = computeCallCredits({ tokensNew, tokensCached, tokensOut }, callRates);

    expect(actual.toFixed(6)).toBe(expected);
    expect(actual.decimalPlaces()).toBeLessThanOrEqual(6);
  });
});
