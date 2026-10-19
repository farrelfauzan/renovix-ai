import { Decimal } from "@prisma/client/runtime/client";
import { assertCreditAmount } from "./assert-credit-amount";

// RX-22: a hold or a charge is finite, not negative and whole micro-credits.
describe("assertCreditAmount", () => {
  it.each(["0", "1", "0.000001", "123.456789"])("accepts %s", (value) => {
    expect(() => assertCreditAmount(new Decimal(value))).not.toThrow();
  });

  it.each(["NaN", "Infinity", "-Infinity", "-0.000001", "0.0000001"])("refuses %s", (value) => {
    expect(() => assertCreditAmount(new Decimal(value))).toThrow(/credit amount/);
  });
});
