import { Decimal } from "@prisma/client/runtime/client";
import { estimateCallCredits } from "./estimate-call-credits";

const rates = (rateNew: string, rateCached: string, rateOut: string) => ({
  rateNew: new Decimal(rateNew),
  rateCached: new Decimal(rateCached),
  rateOut: new Decimal(rateOut),
});

// RX-22: docs/credits.md section 3.1 rule 1: E = I x max(new rate, cached rate) + M x output rate, rounded up.
describe("estimateCallCredits", () => {
  it("example (a), Premium 10/20/11: 30,145 x 20 + 4,096 x 11 = 647,956 micro-credits", () => {
    expect(estimateCallCredits(30_145, 4_096, rates("10", "20", "11")).toFixed(6)).toBe("0.647956");
  });

  it("Advanced 5/6/4 uses the cached rate 6 for the input (cached costs more than new)", () => {
    expect(estimateCallCredits(1_000, 100, rates("5", "6", "4")).toFixed(6)).toBe("0.006400");
  });

  it("example (b1), Standard: 2,918 + 2,048 = 4,966 micro-credits", () => {
    expect(estimateCallCredits(2_918, 2_048, rates("1", "1", "1")).toFixed(6)).toBe("0.004966");
  });

  it("a decimal rate rounds up to a whole micro-credit: 3 x 0.5 = 1.5 -> 2", () => {
    expect(estimateCallCredits(2, 1, rates("0.5", "0.5", "0.5")).toFixed(6)).toBe("0.000002");
  });
});
