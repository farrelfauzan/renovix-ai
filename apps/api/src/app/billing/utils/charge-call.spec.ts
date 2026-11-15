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
const view = (charged: ReturnType<typeof chargeCall>) =>
  charged.map(({ charge }) => [charge.fromHold, charge.fromAvailable, charge.uncharged].map((d) => d.toFixed(6)));

// RX-22: docs/credits.md section 3.1 rules 4 and 6. The call costs 1.000000 credit.
describe("chargeCall", () => {
  it("completed: the remaining hold first, the overrun from available", () => {
    expect(view(chargeCall(record("completed"), [{ reservation: reservation("open"), account }]))).toEqual([["0.600000", "0.400000", "0.000000"]]);
  });

  it("provider error: nothing charged, all of it uncharged", () => {
    expect(view(chargeCall(record("provider_error"), [{ reservation: reservation("open"), account }]))).toEqual([["0.000000", "0.000000", "1.000000"]]);
  });

  it("a reservation already expired by the sweep has no hold left: charged from available", () => {
    expect(view(chargeCall(record("client_cancel"), [{ reservation: reservation("expired"), account }]))).toEqual([["0.000000", "1.000000", "0.000000"]]);
  });

  // RNX-58a: a two-wallet hold, weekly_free (0.6 held of a 0.6 balance) first, then paid (0.6 held of 5).
  const weeklyFree = { reservation: reservation("open"), account: { balance: new Decimal("0.6"), held: new Decimal("0.6") } as CreditAccount };
  const paid = { reservation: reservation("open"), account };

  it("two parts: weekly_free's hold first, then paid's hold, the overrun from paid's available; one charge per part", () => {
    expect(view(chargeCall(record("completed"), [weeklyFree, paid]))).toEqual([
      ["0.600000", "0.000000", "0.000000"],
      ["0.400000", "0.000000", "0.000000"],
    ]);
  });

  it("two parts, a call the weekly_free hold covers: only the weekly_free part is charged", () => {
    const small = { ...record("completed"), tokens: { tokensNew: 300_000, tokensCached: 0, tokensOut: 0 } };

    expect(view(chargeCall(small, [weeklyFree, paid]))).toEqual([["0.300000", "0.000000", "0.000000"]]);
  });

  it("two parts, a provider error: nothing charged, one part (the last) with all of it uncharged", () => {
    expect(view(chargeCall(record("provider_error"), [weeklyFree, paid]))).toEqual([["0.000000", "0.000000", "1.000000"]]);
  });

  it("a call of 0 credits still gets one entry, on the last part", () => {
    const empty = { ...record("completed"), tokens: { tokensNew: 0, tokensCached: 0, tokensOut: 0 } };

    expect(chargeCall(empty, [weeklyFree, paid]).map(({ reservation: r, account: a }) => [r, a])).toEqual([[paid.reservation, paid.account]]);
  });
});
