import type { CreditCallOutcome } from "@generated/prisma/client.js";

/**
 * The outcome of a paid portal stream's one model call (docs/credits.md section 3.1 rules 6 and 7, RX-22 review):
 * a provider failure is `provider_error`, also after the client went away; a client that went away is
 * `client_cancel` only once the stream opened (its first chunk arrived), before that the call failed
 * (`provider_error`, charged 0); otherwise `completed`.
 */
export function streamedCallOutcome(state: { providerFailed: boolean; aborted: boolean; streamOpened: boolean }): CreditCallOutcome {
  if (state.providerFailed) return "provider_error";
  if (!state.aborted) return "completed";
  return state.streamOpened ? "client_cancel" : "provider_error";
}
