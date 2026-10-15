import { hasSameValues } from "./has-same-values";

describe("hasSameValues", () => {
  it("compares only the keys of the values, a Decimal-like column equal to the number it was written from", () => {
    const inputRow = { priceRupiah: 150000, creditsGranted: { toString: () => "2.5" }, allowedTiers: ["standard"], id: "x" };
    expect(hasSameValues(inputRow, { priceRupiah: 150000, creditsGranted: 2.5, allowedTiers: ["standard"] })).toBe(true);
  });

  it("is false when one value differs", () => {
    const inputRow = { priceRupiah: 150000, allowedTiers: ["standard"] };
    expect(hasSameValues(inputRow, { priceRupiah: 175000, allowedTiers: ["standard"] })).toBe(false);
    expect(hasSameValues(inputRow, { priceRupiah: 150000, allowedTiers: ["standard", "advanced"] })).toBe(false);
  });
});
