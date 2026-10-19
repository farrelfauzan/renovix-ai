import { Decimal } from "@prisma/client/runtime/client";
import type { CreditAccount, CreditReservation } from "@generated/prisma/client.js";
import { chargeCall } from "./charge-call";
import type { UsageRecord } from "../types/usage-record";

const record = (outcome: UsageRecord["outcome"]): UsageRecord => ({
  reservationId: "r",
  memberUserId: "u",
  requestId: "req",
  callId: "call",
  modelId: "m",
  tier: "standard",
  rates: { rateNew: new Decimal(1), rateCached: new Decimal(1), rateOut: new Decimal(1) },
  tokens: { tokensNew: 600_000, tokensCached: 0, tokensOut: 400_000 },
  outcome,
});
const reservation = (status: CreditReservation["status"]) =>
  ({ status, amountHeld: new Decimal("0.6"), consumed: new Decimal(0) }) as CreditReservation;
const account = { balance: new Decimal("5"), held: new Decimal("0.6") } as CreditAccount;
const view = (charge: ReturnType<typeof chargeCall>) => [charge.fromHold, charge.fromAvailable, charge.uncharged].map((d) => d.toFixed(6));

// RX-22: docs/credits.md section 3.1 rules 4 and 6. The call costs 1.000000 credit.
describe("chargeCall", () => {
  it("completed: the remaining hold first, the overrun from available", () => {
    expect(view(chargeCall(record("completed"), reservation("open"), account))).toEqual(["0.600000", "0.400000", "0.000000"]);
  });

  it("provider error: nothing charged, all of it uncharged", () => {
    expect(view(chargeCall(record("provider_error"), reservation("open"), account))).toEqual(["0.000000", "0.000000", "1.000000"]);
  });

  it("a reservation already expired by the sweep has no hold left: charged from available", () => {
    expect(view(chargeCall(record("client_cancel"), reservation("expired"), account))).toEqual(["0.000000", "1.000000", "0.000000"]);
  });
});
