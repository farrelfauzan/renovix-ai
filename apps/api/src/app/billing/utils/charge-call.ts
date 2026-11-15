import { Decimal } from "@prisma/client/runtime/client";
import type { CreditReservation } from "@generated/prisma/client.js";
import type { ChargedPart } from "../types/charged-part";
import type { ReservationPart } from "../types/reservation-part";
import type { UsageCharge } from "../types/usage-charge";
import type { UsageRecord } from "../types/usage-record";
import { computeCallCredits } from "./compute-call-credits";
import { splitUsageCharge } from "./split-usage-charge";

const NO_CREDITS = new Decimal(0);

/** The hold an open reservation still has; a closed one (e.g. expired by the sweep) has none left. */
const remainingHoldOf = (reservation: CreditReservation): Decimal =>
  reservation.status === "open" ? reservation.amountHeld.minus(reservation.consumed) : NO_CREDITS;

/** Whether a part's charge takes or leaves uncharged any credit. */
const isNonZero = ({ charge }: ChargedPart): boolean => !charge.fromHold.plus(charge.fromAvailable).plus(charge.uncharged).isZero();

/**
 * How one model call's credits are taken (docs/credits.md section 3.1 rules 4 and 6), read from the locked account
 * rows and the reservation's parts in their order: a provider error takes nothing (all of it is uncharged); otherwise
 * each part in turn takes what is left of the call from its remaining hold, then from its wallet's available credits
 * (RNX-58a: weekly_free before paid). What no part covers is uncharged, on the last part. Returns the parts that get a
 * usage entry: those the call charged or left credits uncharged on, else (a call of 0 credits) the last part.
 */
export function chargeCall(record: UsageRecord, parts: readonly ReservationPart[]): ChargedPart[] {
  const isProviderError = record.outcome === "provider_error";
  const charges = parts.reduce<UsageCharge[]>((taken, { reservation, account }) => {
    const rest = taken.at(-1)?.uncharged ?? computeCallCredits(record.tokens, record.rates);
    const charge = isProviderError
      ? splitUsageCharge(rest, NO_CREDITS, NO_CREDITS)
      : splitUsageCharge(rest, remainingHoldOf(reservation), account.balance.minus(account.held));
    return [...taken, charge];
  }, []);
  const charged = parts.map((part, i) => ({
    ...part,
    charge: i === parts.length - 1 ? charges[i] : { ...charges[i], uncharged: NO_CREDITS },
  }));
  const withCredits = charged.filter(isNonZero);
  return withCredits.length > 0 ? withCredits : charged.slice(-1);
}
