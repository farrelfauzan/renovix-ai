import { Decimal } from "@prisma/client/runtime/client";
import type { CreditAccount, CreditReservation } from "@generated/prisma/client.js";
import type { UsageCharge } from "../types/usage-charge";
import type { UsageRecord } from "../types/usage-record";
import { computeCallCredits } from "./compute-call-credits";
import { splitUsageCharge } from "./split-usage-charge";

const NO_CREDITS = new Decimal(0);

/**
 * How one model call's credits are taken (docs/credits.md section 3.1 rules 4 and 6), read from the locked account
 * row and the reservation: a provider error takes nothing (all of it is uncharged); otherwise the remaining hold of
 * an open reservation first (a closed one, e.g. expired by the sweep, has none left), then the available credits.
 */
export function chargeCall(record: UsageRecord, reservation: CreditReservation, account: CreditAccount): UsageCharge {
  const credits = computeCallCredits(record.tokens, record.rates);
  if (record.outcome === "provider_error") return splitUsageCharge(credits, NO_CREDITS, NO_CREDITS);
  const remainingHold = reservation.status === "open" ? reservation.amountHeld.minus(reservation.consumed) : NO_CREDITS;
  return splitUsageCharge(credits, remainingHold, account.balance.minus(account.held));
}
