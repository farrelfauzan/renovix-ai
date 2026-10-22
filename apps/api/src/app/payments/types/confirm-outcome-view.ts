import type { CheckOutcome } from "./check-outcome";

/** The answer to "confirm from provider" (RNX-35): the order, what the check did, and the status it has now. */
export type ConfirmOutcomeView = {
  readonly orderId: string;
  readonly outcome: CheckOutcome;
  readonly status: string;
};
