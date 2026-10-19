import { Decimal } from "@prisma/client/runtime/client";
import type { CreditLedgerEntry } from "@generated/prisma/client.js";
import { isSameUsage } from "./is-same-usage";
import type { UsageRecord } from "../types/usage-record";

const record: UsageRecord = {
  reservationId: "r",
  memberUserId: "u",
  requestId: "req",
  callId: "call-1",
  modelId: "m",
  tier: "standard",
  rates: { rateNew: new Decimal(1), rateCached: new Decimal(1), rateOut: new Decimal(1) },
  tokens: { tokensNew: 300_000, tokensCached: 0, tokensOut: 100_000 },
  outcome: "completed",
};
// The entry the record wrote: 0.4 credit, 0.3 charged and 0.1 uncharged (an overrun the balance could not cover).
const entry = {
  type: "usage",
  outcome: "completed",
  modelId: "m",
  tier: "standard",
  rateNew: new Decimal(1),
  rateCached: new Decimal(1),
  rateOut: new Decimal(1),
  tokensNew: 300_000,
  tokensCached: 0,
  tokensOut: 100_000,
  amount: new Decimal("-0.3"),
  uncharged: new Decimal("0.1"),
} as CreditLedgerEntry;

// RX-22 review NIT 5: a replay is the same call only when every recorded field matches.
describe("isSameUsage", () => {
  it("the same call (charged + uncharged = its credits)", () => {
    expect(isSameUsage(entry, record)).toBe(true);
  });

  it.each([
    ["other tokens", { tokens: { ...record.tokens, tokensOut: 1 } }],
    ["another outcome", { outcome: "provider_error" as const }],
    ["another rate", { rates: { ...record.rates, rateOut: new Decimal(2) } }],
    ["another model", { modelId: "other" }],
    ["another tier", { tier: "premium" }],
  ])("%s: not the same call", (_case, override) => {
    expect(isSameUsage(entry, { ...record, ...override })).toBe(false);
  });

  it("an entry whose amounts do not add up to the call's credits is not the same call", () => {
    expect(isSameUsage({ ...entry, uncharged: new Decimal(0) } as CreditLedgerEntry, record)).toBe(false);
  });
});
