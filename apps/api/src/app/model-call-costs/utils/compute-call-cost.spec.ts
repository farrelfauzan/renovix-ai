import { Decimal } from "@prisma/client/runtime/client";
import type { CallCostBasis } from "../../providers/types/call-cost-basis";
import type { CallCostInput } from "../types/call-cost-input";
import { computeCallCost } from "./compute-call-cost";

// RNX-162: what one model call cost us, from its tokens, the reported cost, the model's prices, the provider's cost
// settings and the USD to IDR rate. Decimal throughout.

const basisOf = (over: Partial<CallCostBasis> = {}): CallCostBasis => ({
  providerRecordId: "provider-1",
  inputPrice: new Decimal("0.000001"),
  cachedInputPrice: new Decimal("0.0000005"),
  outputPrice: new Decimal("0.000002"),
  costMultiplier: null,
  perCallFloorUsd: null,
  highCaseFactor: null,
  highCaseTokenThreshold: null,
  ...over,
});

const inputOf = (over: Partial<CallCostInput> = {}): CallCostInput => ({
  tokens: { tokensNew: 1000, tokensCached: 400, tokensOut: 200 },
  reportedCostUsd: null,
  basis: basisOf(),
  rate: new Decimal("16250.5"),
  ...over,
});

/** Every figure as a string (null stays null). */
const figuresOf = (input: CallCostInput) =>
  Object.fromEntries(Object.entries(computeCallCost(input)).map(([key, value]) => [key, value?.toString() ?? null]));

describe("computeCallCost", () => {
  it("token price = new x input + cached x cached input + output x output; rupiah = USD x rate", () => {
    expect(figuresOf(inputOf())).toEqual({
      tokenPriceUsd: "0.0016",
      costLowUsd: "0.0016",
      costHighUsd: "0.0016",
      costLowIdr: "26.0008",
      costHighIdr: "26.0008",
    });
  });

  it("a model with no cached price prices the cached tokens at the input price (a conservative upper bound)", () => {
    expect(figuresOf(inputOf({ basis: basisOf({ cachedInputPrice: null }) })).tokenPriceUsd).toBe("0.0018");
  });

  it("no usable rate: the rupiah figures are null, the USD figures kept", () => {
    expect(figuresOf(inputOf({ rate: null }))).toEqual({
      tokenPriceUsd: "0.0016",
      costLowUsd: "0.0016",
      costHighUsd: "0.0016",
      costLowIdr: null,
      costHighIdr: null,
    });
  });

  it("a reported cost x the provider multiplier is low; the token-price figure is still computed", () => {
    const actual = figuresOf(inputOf({ reportedCostUsd: new Decimal("0.10"), basis: basisOf({ costMultiplier: new Decimal("1.5") }) }));

    expect([actual.tokenPriceUsd, actual.costLowUsd, actual.costHighUsd]).toEqual(["0.0016", "0.15", "0.15"]);
  });

  it("a reported cost without a multiplier is low as it is (multiplier 1)", () => {
    expect(figuresOf(inputOf({ reportedCostUsd: new Decimal("0.10") })).costLowUsd).toBe("0.1");
  });

  it("a reported cost of 0 is a reported cost (low 0, not the token price)", () => {
    expect(figuresOf(inputOf({ reportedCostUsd: new Decimal(0) })).costLowUsd).toBe("0");
  });

  it.each([
    ["a tiny call: the floor", { tokensNew: 3, tokensCached: 0, tokensOut: 2 }, "0.01"],
    ["a large call: the token price, above the floor", { tokensNew: 10000, tokensCached: 0, tokensOut: 5000 }, "0.02"],
  ])("the per-call floor: %s", (_case, tokens, expectedLow) => {
    expect(figuresOf(inputOf({ tokens, basis: basisOf({ perCallFloorUsd: new Decimal("0.01") }) })).costLowUsd).toBe(expectedLow);
  });

  it("the floor also bounds a reported cost x multiplier", () => {
    const basis = basisOf({ perCallFloorUsd: new Decimal("0.01"), costMultiplier: new Decimal(2) });

    expect(figuresOf(inputOf({ reportedCostUsd: new Decimal("0.001"), basis })).costLowUsd).toBe("0.01");
  });

  it.each([
    ["factor and threshold set, total tokens (1600) above the threshold: high = low x factor", { highCaseFactor: new Decimal("1.5"), highCaseTokenThreshold: 1000 }, "0.0024"],
    ["total tokens equal to the threshold: high = low", { highCaseFactor: new Decimal("1.5"), highCaseTokenThreshold: 1600 }, "0.0016"],
    ["only the factor set: off", { highCaseFactor: new Decimal("1.5") }, "0.0016"],
    ["only the threshold set: off", { highCaseTokenThreshold: 1 }, "0.0016"],
  ])("the high case: %s", (_case, over, expectedHigh) => {
    const actual = figuresOf(inputOf({ basis: basisOf(over) }));

    expect([actual.costLowUsd, actual.costHighUsd]).toEqual(["0.0016", expectedHigh]);
  });

  it("the high case applies to low after the floor, and to the rupiah high figure", () => {
    const basis = basisOf({ perCallFloorUsd: new Decimal("0.01"), highCaseFactor: new Decimal(2), highCaseTokenThreshold: 1 });

    expect(figuresOf(inputOf({ tokens: { tokensNew: 3, tokensCached: 0, tokensOut: 2 }, basis, rate: new Decimal(16000) }))).toEqual({
      tokenPriceUsd: "0.000007",
      costLowUsd: "0.01",
      costHighUsd: "0.02",
      costLowIdr: "160",
      costHighIdr: "320",
    });
  });

  it("no prices known (no cost basis): the token price is null; low and high come from the reported cost", () => {
    expect(figuresOf(inputOf({ basis: null, reportedCostUsd: new Decimal("0.002") }))).toEqual({
      tokenPriceUsd: null,
      costLowUsd: "0.002",
      costHighUsd: "0.002",
      costLowIdr: "32.501",
      costHighIdr: "32.501",
    });
  });

  it("neither a reported cost nor prices: every figure is null", () => {
    expect(Object.values(figuresOf(inputOf({ basis: null })))).toEqual([null, null, null, null, null]);
  });
});
