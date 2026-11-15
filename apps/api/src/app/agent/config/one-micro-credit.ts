import { Decimal } from "@prisma/client/runtime/client";

/** The smallest charge: an agent message needs at least this much available before any model call (RX-22b). */
export const ONE_MICRO_CREDIT = new Decimal("0.000001");
