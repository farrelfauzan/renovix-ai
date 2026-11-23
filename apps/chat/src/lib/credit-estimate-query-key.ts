/**
 * React Query key of one pre-send credit estimate (POST /chat/portal/credit-estimate, RNX-331). Keyed by the account's
 * email, the model and the messages the estimate was asked for.
 */
export const creditEstimateQueryKey = (email: string | null, model: string, messages: readonly unknown[]) =>
  ["credit-estimate", email, model, messages] as const;
