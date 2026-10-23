import { z } from "zod";
import { CREDIT_AMOUNT } from "../../offers/config/credit-amount";
import { MODEL_TIERS } from "../../offers/config/model-tiers";

const MAX_NAME_LENGTH = 100;

/**
 * POST /auth/keys (RNX-18): a name for the key and how long it lives ("never": no expiry). RNX-232 (D47): the model
 * tiers it may call (only tiers the user's package allows; left out: every tier the package allows) and an optional
 * monthly credit cap (Asia/Jakarta calendar month; left out: no cap).
 */
export const CreateApiKeyDto = z.strictObject({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  expiresIn: z.enum(["30d", "90d", "1y", "never"]),
  allowedTiers: z.array(z.enum(MODEL_TIERS)).min(1).optional(),
  monthlyCreditCap: CREDIT_AMOUNT.positive().optional(),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeyDto>;
