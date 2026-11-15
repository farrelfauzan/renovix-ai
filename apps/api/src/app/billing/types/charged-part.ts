import type { ReservationPart } from "./reservation-part";
import type { UsageCharge } from "./usage-charge";

/** RNX-58a: one wallet part of a hold with what a model call takes from it; it gets one usage entry. */
export type ChargedPart = ReservationPart & {
  readonly charge: UsageCharge;
};
