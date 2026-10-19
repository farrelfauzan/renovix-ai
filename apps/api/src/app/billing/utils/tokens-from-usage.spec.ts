import { tokensFromUsage } from "./tokens-from-usage";

// RX-22: new input = prompt - cached.
describe("tokensFromUsage", () => {
  it("splits the prompt into new and cached input", () => {
    expect(tokensFromUsage(100, 60, 50)).toEqual({ tokensNew: 40, tokensCached: 60, tokensOut: 50 });
  });

  it("never gives negative new input", () => {
    expect(tokensFromUsage(10, 20, 0)).toEqual({ tokensNew: 0, tokensCached: 20, tokensOut: 0 });
  });
});
