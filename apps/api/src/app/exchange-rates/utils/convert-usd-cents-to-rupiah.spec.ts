import { Decimal } from "@prisma/client/runtime/client";
import { convertUsdCentsToRupiah } from "./convert-usd-cents-to-rupiah";

// RNX-53 AC Conversion: rupiah = USD cents x rate / 100, rounded UP to the next whole Rp1.000. The rates are
// throwaway test values, not a real or fallback rate.
describe("convertUsdCentsToRupiah (RNX-53)", () => {
  it.each([
    ["US$19 at 16500 rounds 313,500 up to 314,000", 1900, "16500", 314000],
    ["an exact multiple of Rp1.000 stays as it is", 2000, "16500", 330000],
    ["a fractional rate rounds the exact product up (1900 x 16523.45 / 100 = 313,945.55)", 1900, "16523.45", 314000],
    ["a fractional rate one rupiah over a step still rounds up (1 cent x 100,000.01 = 1,000.0001)", 1, "100000.01", 2000],
    ["0 cents is Rp0", 0, "16500", 0],
  ])("%s", (_case, inputUsdCents, inputRate, expectedRupiah) => {
    const actualRupiah = convertUsdCentsToRupiah({ usdCents: inputUsdCents, rate: new Decimal(inputRate) });
    expect(actualRupiah).toBe(expectedRupiah);
  });
});
