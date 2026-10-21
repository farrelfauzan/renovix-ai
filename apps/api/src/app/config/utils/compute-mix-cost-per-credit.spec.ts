import { Decimal } from "@prisma/client/runtime/client";
import { computeMixCostPerCredit } from "./compute-mix-cost-per-credit";

/** Prices in dollars per 1,000,000 tokens (as docs/credits.md section 14.1 lists them) to dollars per token. */
const pricesPerMillion = (newInput: string, cachedInput: string, output: string) => ({
  newInput: new Decimal(newInput).div(1_000_000),
  cachedInput: new Decimal(cachedInput).div(1_000_000),
  output: new Decimal(output).div(1_000_000),
});
const rates = (newInput: string, cachedInput: string, output: string) => ({
  newInput: new Decimal(newInput),
  cachedInput: new Decimal(cachedInput),
  output: new Decimal(output),
});

// RNX-185: docs/credits.md sections 14.2 and 14.5, the cost per credit at the token mix 0.36 / 0.54 / 0.10.
describe("computeMixCostPerCredit", () => {
  it.each([
    { name: "GLM 5.3 Flash on Standard 1/1/1 (section 14.2 baseline)", prices: pricesPerMillion("0.15", "0.03", "0.50"), rates: rates("1", "1", "1"), expected: "0.1202" },
    { name: "Opus 5.5 on Frontier 29/29/42: 3.548 / 30.3", prices: pricesPerMillion("4", "0.20", "20"), rates: rates("29", "29", "42"), expected: "0.117096" },
    { name: "DeepSeek V4.1 Flash at peak on Standard (section 14.3 worst case)", prices: pricesPerMillion("0.30", "0.03", "1.20"), rates: rates("1", "1", "1"), expected: "0.2442" },
  ])("$name", ({ prices, rates: tierRates, expected }) => {
    const actual = computeMixCostPerCredit({ pricesPerToken: prices, ratesPerMillionTokens: tierRates });

    expect(actual.toDecimalPlaces(6).toFixed()).toBe(expected);
  });
});
