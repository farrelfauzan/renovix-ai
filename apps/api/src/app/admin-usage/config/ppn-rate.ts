import { Decimal } from "@prisma/client/runtime/client";

/**
 * PPN (Indonesian VAT), 11% (RNX-228). A documented constant, not a platform setting: the ticket makes only the
 * payment gateway fee and the drift threshold settings. List prices are taken to include PPN, so the PPN part of a
 * gross amount is gross x 0.11 / 1.11.
 */
export const PPN_RATE = new Decimal("0.11");
