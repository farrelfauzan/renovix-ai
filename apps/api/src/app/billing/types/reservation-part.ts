import type { CreditAccount, CreditReservation } from "@generated/prisma/client.js";

/**
 * RNX-58a: one wallet's part of a request's hold, read while its account row is locked: the part's reservation row and
 * its account row. A hold has one part (one wallet), or two on the home chat's Standard tier (weekly_free, then paid).
 */
export type ReservationPart = {
  readonly reservation: CreditReservation;
  readonly account: CreditAccount;
};
