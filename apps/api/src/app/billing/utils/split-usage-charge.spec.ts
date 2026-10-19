import { Decimal } from "@prisma/client/runtime/client";
import { splitUsageCharge } from "./split-usage-charge";

const split = (amount: string, hold: string, available: string) => {
  const charge = splitUsageCharge(new Decimal(amount), new Decimal(hold), new Decimal(available));
  return [charge.fromHold.toFixed(6), charge.fromAvailable.toFixed(6), charge.uncharged.toFixed(6)];
};

// RX-22: docs/credits.md section 3.1 rule 4.
describe("splitUsageCharge", () => {
  it("within the hold: all from the hold", () => {
    expect(split("0.540307", "0.647956", "22.539474")).toEqual(["0.540307", "0.000000", "0.000000"]);
  });

  it("an overrun is taken from the available balance", () => {
    expect(split("1.0", "0.6", "5")).toEqual(["0.600000", "0.400000", "0.000000"]);
  });

  it("what the available balance cannot cover is uncharged (I5)", () => {
    expect(split("1.0", "0.6", "0.1")).toEqual(["0.600000", "0.100000", "0.300000"]);
  });

  it("no hold left (closed reservation) and nothing available: all uncharged", () => {
    expect(split("0.5", "0", "0")).toEqual(["0.000000", "0.000000", "0.500000"]);
  });
});
