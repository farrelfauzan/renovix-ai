import { Decimal } from "@prisma/client/runtime/client";
import { availableCredits } from "./available-credits";

describe("availableCredits (RNX-30-A)", () => {
  it("balance - held", () => {
    const actual = availableCredits({ balance: new Decimal("12.500000"), held: new Decimal("2.000001") });

    expect(actual.toString()).toBe("10.499999");
  });

  it("no account: 0", () => {
    const actual = availableCredits(null);

    expect(actual.toString()).toBe("0");
  });
});
