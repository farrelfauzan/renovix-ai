import type { CheckSource } from "./check-source";
import type { ProviderPaymentState } from "./provider-payment-state";

/** Why an order's status is checked (RNX-35): the source, the admin and their reason (admin only), and what a webhook claimed. */
export type OrderCheck = {
  readonly source: CheckSource;
  readonly actorId: string | null;
  readonly note: string | null;
  readonly reportedState: ProviderPaymentState | null;
};
