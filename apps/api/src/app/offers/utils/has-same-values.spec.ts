import { hasSameValues } from "./has-same-values";

describe("hasSameValues", () => {
  it("compares only the keys of the values, a Decimal-like column equal to the number it was written from", () => {
    const inputRow = { priceUsdCents: 1500, creditsGranted: { toString: () => "2.5" }, allowedTiers: ["standard"], id: "x" };
    expect(hasSameValues(inputRow, { priceUsdCents: 1500, creditsGranted: 2.5, allowedTiers: ["standard"] })).toBe(true);
  });

  it("is false when one value differs", () => {
    const inputRow = { priceUsdCents: 1500, allowedTiers: ["standard"] };
    expect(hasSameValues(inputRow, { priceUsdCents: 1750, allowedTiers: ["standard"] })).toBe(false);
    expect(hasSameValues(inputRow, { priceUsdCents: 1500, allowedTiers: ["standard", "advanced"] })).toBe(false);
  });
});
