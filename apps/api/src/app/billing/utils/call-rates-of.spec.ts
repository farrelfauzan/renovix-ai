import { Decimal } from "@prisma/client/runtime/client";
import { callRatesOf } from "./call-rates-of";

describe("callRatesOf", () => {
  it("maps a tier's input/cached/output rates to the usage entry's new/cached/out rates", () => {
    const tierRates = { inputCreditsPerToken: new Decimal(5), cachedCreditsPerToken: new Decimal(6), outputCreditsPerToken: new Decimal(4) };

    expect(callRatesOf(tierRates)).toEqual({ rateNew: tierRates.inputCreditsPerToken, rateCached: tierRates.cachedCreditsPerToken, rateOut: tierRates.outputCreditsPerToken });
  });
});
