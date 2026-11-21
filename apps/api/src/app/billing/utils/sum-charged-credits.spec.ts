import { Decimal } from "@prisma/client/runtime/client";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import { sumChargedCredits } from "./sum-charged-credits";

const entryOf = (amount: string, uncharged: string): CreditLedgerEntry =>
  ({ amount: new Decimal(amount), uncharged: new Decimal(uncharged) }) as CreditLedgerEntry;

// RNX-340: the UsageLog cost of a call is what its usage entries charged, across wallets.
describe("sumChargedCredits", () => {
  it("a call split over weekly_free and paid: the two parts' charges added", () => {
    expect(sumChargedCredits([entryOf("-0.1", "0"), entryOf("-0.25", "0")]).toFixed(6)).toBe("0.350000");
  });

  it("one entry: its charge", () => {
    expect(sumChargedCredits([entryOf("-0.000015", "0")]).toFixed(6)).toBe("0.000015");
  });

  it("the uncharged part of an overrun is not counted", () => {
    expect(sumChargedCredits([entryOf("-0.1", "0"), entryOf("-0.2", "0.05")]).toFixed(6)).toBe("0.300000");
  });

  it("a provider error (charged 0, all uncharged): 0", () => {
    expect(sumChargedCredits([entryOf("0", "0.4")]).toFixed(6)).toBe("0.000000");
  });
});
