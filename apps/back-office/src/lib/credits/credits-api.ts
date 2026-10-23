import type { ApiClient } from "@/lib/api/api-client";
import { sendAdminRequest } from "@/lib/api/send-admin-request";
import type { CreditAdjustmentEntry } from "./credit-adjustment-entry";
import type { CreditAdjustmentInput } from "./credit-adjustment-input";

/**
 * The credit routes of RNX-227. `adjust` throws SignedOutError when the session is over, ReauthRequiredError
 * without a recent re-authentication, and a RefusedError with a readable message for any other refusal.
 */
export type CreditsApi = {
  /** Adds or removes credits on a wallet; the same idempotency key answers the same entry instead of writing twice. */
  readonly adjust: (input: CreditAdjustmentInput, idempotencyKey: string) => Promise<CreditAdjustmentEntry>;
};

/** The credit routes on the session client. */
export function createCreditsApi(client: ApiClient): CreditsApi {
  return {
    adjust: async (input, idempotencyKey) => (await sendAdminRequest(client, "/credits/adjustments", "POST", { ...input, idempotencyKey })).json(),
  };
}
