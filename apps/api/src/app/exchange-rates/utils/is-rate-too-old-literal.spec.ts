import { isRateTooOld } from "./is-rate-too-old";

// RNX-236: pins the decided 7-day limit (D237) with literal ages; deliberately does not import MAX_RATE_AGE_DAYS,
// so changing the constant turns these red.
describe("isRateTooOld with literal ages (RNX-236)", () => {
  const inputNow = new Date("2026-10-21T23:59:00.000Z");

  it("a rate dated exactly 7 UTC calendar days ago is not too old", () => {
    const inputRateDate = new Date(Date.UTC(2026, 9, 14));
    const actual = isRateTooOld({ rateDate: inputRateDate, now: inputNow });
    expect(actual).toBe(false);
  });

  it("a rate dated 8 UTC calendar days ago is too old", () => {
    const inputRateDate = new Date(Date.UTC(2026, 9, 13));
    const actual = isRateTooOld({ rateDate: inputRateDate, now: inputNow });
    expect(actual).toBe(true);
  });
});
